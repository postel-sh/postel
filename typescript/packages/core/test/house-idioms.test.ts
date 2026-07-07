import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  InMemoryStorage,
  type InMemoryTx,
  type JwksKeyset,
  Postel,
  Secret,
  type SecretOrJwksKeyset,
  type SecretValue,
  TimestampTooOld,
  type Unsubscribe,
  createJwksKeyset,
  signFixture,
  verify,
} from "../src/index.js";

const fixedClock = (at: Date) => ({ now: () => at, sleep: () => Promise.resolve() });

const SECRET = "whsec_ZGVtby1zZWNyZXQtYS1mb3ItcG9zdGVsLXRlc3Q=";
const SIGNED_AT = new Date("2026-05-14T10:00:00Z");
const NINE_MINUTES_LATER = new Date("2026-05-14T10:09:00Z");

const PAYLOAD = { type: "order.created", data: { id: "order_42" } } as const;

function loopbackPostel() {
  const storage = InMemoryStorage();
  return {
    storage,
    postel: Postel({
      outbound: { storage, http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } },
    }),
  };
}

describe("House API idioms [PORT-SPECIFIC]", () => {
  it("Duration strings are accepted wherever seconds are: tolerance '10m' behaves like tolerance 600", async () => {
    const fixture = await signFixture({ secret: SECRET, payload: PAYLOAD, timestamp: SIGNED_AT });
    const clock = fixedClock(NINE_MINUTES_LATER);

    const withString = Postel({
      inbound: { vendor: { verify: Secret(SECRET), tolerance: "10m", clock } },
    });
    const withSeconds = Postel({
      inbound: { vendor: { verify: Secret(SECRET), tolerance: 600, clock } },
    });
    const stringResult = await withString.inbound.vendor.verify(fixture.body, fixture.headers);
    const secondsResult = await withSeconds.inbound.vendor.verify(fixture.body, fixture.headers);
    expect(stringResult.event.type).toBe("order.created");
    expect(secondsResult.event.type).toBe("order.created");

    const tooNarrow = Postel({
      inbound: { vendor: { verify: Secret(SECRET), tolerance: "5m", clock } },
    });
    await expect(
      tooNarrow.inbound.vendor.verify(fixture.body, fixture.headers),
    ).rejects.toBeInstanceOf(TimestampTooOld);
  });

  it("Clock is the single time-injection idiom: inbound sources and verify() take clock, not now", async () => {
    const fixture = await signFixture({ secret: SECRET, payload: PAYLOAD, timestamp: SIGNED_AT });

    const standalone = await verify(fixture.body, fixture.headers, SECRET, {
      clock: fixedClock(SIGNED_AT),
    });
    expect(standalone.event.type).toBe("order.created");

    const postel = Postel({
      inbound: { vendor: { verify: Secret(SECRET), clock: fixedClock(SIGNED_AT) } },
    });
    const sourced = await postel.inbound.vendor.verify(fixture.body, fixture.headers);
    expect(sourced.event.type).toBe("order.created");

    // Without an injected clock, wall time applies and the 2026-05-14 fixture
    // is far outside the default window — proof the injected clock was used.
    await expect(verify(fixture.body, fixture.headers, SECRET)).rejects.toBeInstanceOf(
      TimestampTooOld,
    );
  });

  it("Package root has no renamed re-exports: source names are exported as-is", () => {
    const indexSource = readFileSync(
      fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      "utf8",
    );
    expect(indexSource).not.toMatch(/^\s+\w+ as \w+,?$/m);

    expect(typeof createJwksKeyset).toBe("function");
    const secret: SecretValue = SECRET;
    const input: SecretOrJwksKeyset = secret;
    const keyset: JwksKeyset = createJwksKeyset({
      jwksUri: "https://example/jwks",
      fetch: () => Promise.reject(new Error("never fetched")),
    });
    const unsubscribe: Unsubscribe = () => {};
    expect(input).toBe(secret);
    expect(typeof keyset.findByKid).toBe("function");
    expect(typeof unsubscribe).toBe("function");
  });
});

describe("Timestamp window enforcement", () => {
  it("Duration-string window: tolerance '10m' with a 9-minute-old timestamp verifies, identically to 600 seconds", async () => {
    const fixture = await signFixture({ secret: SECRET, payload: PAYLOAD, timestamp: SIGNED_AT });
    const postel = Postel({
      inbound: {
        vendor: {
          verify: Secret(SECRET),
          tolerance: "10m",
          clock: fixedClock(NINE_MINUTES_LATER),
        },
      },
    });
    const result = await postel.inbound.vendor.verify(fixture.body, fixture.headers);
    expect(result.matchedVerifierIndex).toBe(0);
  });
});

describe("All writes accept an optional transaction parameter", () => {
  it("endpoints.create and endpoints.update take tx in the options bag, not a trailing runtime argument", async () => {
    const { storage, postel } = loopbackPostel();

    const ep = await storage.transaction(async (tx: InMemoryTx) =>
      postel.outbound.endpoints.create({
        url: "http://127.0.0.1:65535/hook",
        allowHttp: true,
        tx,
      }),
    );
    expect(ep.id).toMatch(/^ep_/);

    const updated = await storage.transaction(async (tx: InMemoryTx) =>
      postel.outbound.endpoints.update(ep.id, { types: ["order.*"], tx }),
    );
    expect(updated.id).toBe(ep.id);

    void (() =>
      postel.outbound.endpoints.create({
        url: "https://example.com/hook",
        // @ts-expect-error tx must be the adapter's transaction handle
        tx: 123,
      }));
    void (() =>
      // @ts-expect-error create takes a single options bag, no trailing runtime argument
      postel.outbound.endpoints.create({ url: "https://example.com/hook" }, { tx: {} }));
  });
});
