import { InMemoryDedup, Postel, Secret, signFixture } from "@postel/core";
import { describe, expect, it } from "vitest";

import { handleInbound } from "../src/index.js";

const fixedClock = (at: Date) => ({ now: () => at, sleep: () => Promise.resolve() });

const SECRET = "whsec_aG9uby1hZGFwdGVyLXRlc3Qtc2VjcmV0LWZvci1wb3N0ZWw=";
const NOW = new Date("2026-05-14T13:00:00Z");

function dedupSource() {
  return Postel({
    inbound: {
      vendor: { verify: Secret(SECRET), clock: fixedClock(NOW), dedup: InMemoryDedup() },
    },
  }).inbound.vendor;
}

function plainSource() {
  return Postel({ inbound: { vendor: { verify: Secret(SECRET), clock: fixedClock(NOW) } } }).inbound
    .vendor;
}

function signed(id: string) {
  return signFixture({
    secret: SECRET,
    payload: { type: "order.created", timestamp: "2026-05-14T12:59:55Z", data: { id } },
    messageId: `msg_${id}`,
    timestamp: NOW,
  });
}

describe("Framework adapters offer optional dedup-acknowledgement", () => {
  it("invokes the handler on first receipt with no dedup header", async () => {
    const sig = await signed("a");
    let ran = false;
    const outcome = await handleInbound(
      dedupSource(),
      { rawBody: sig.body, headers: sig.headers, method: "POST" },
      {
        dedup: { ttl: "1h" },
        onVerified: () => {
          ran = true;
        },
      },
    );
    expect(outcome.kind).toBe("verified");
    expect(ran).toBe(true);
  });

  it("acknowledges a duplicate with 2xx + X-Postel-Dedup-Result and skips the handler", async () => {
    const src = dedupSource();
    const sig = await signed("b");
    const req = { rawBody: sig.body, headers: sig.headers, method: "POST" };
    await handleInbound(src, req, { dedup: { ttl: "1h" } });
    let ran = false;
    const second = await handleInbound(src, req, {
      dedup: { ttl: "1h" },
      onVerified: () => {
        ran = true;
      },
    });
    expect(second.kind).toBe("duplicate");
    if (second.kind === "duplicate") {
      expect(second.status).toBe(200);
      expect(second.headers["x-postel-dedup-result"]).toBe("duplicate");
    }
    expect(ran).toBe(false);
  });

  it("is a pass-through when no dedup adapter is configured", async () => {
    const src = plainSource();
    const sig = await signed("c");
    const req = { rawBody: sig.body, headers: sig.headers, method: "POST" };
    const first = await handleInbound(src, req, { dedup: { ttl: "1h" } });
    const second = await handleInbound(src, req, { dedup: { ttl: "1h" } });
    expect(first.kind).toBe("verified");
    expect(second.kind).toBe("verified");
  });

  it("records no dedup state for a request that fails verification (dedup runs only after verify)", async () => {
    const src = dedupSource();
    const sig = await signed("d");
    const reSerialized = JSON.stringify(JSON.parse(sig.body), null, 2);
    const failed = await handleInbound(
      src,
      { rawBody: reSerialized, headers: sig.headers, method: "POST" },
      { dedup: { ttl: "1h" } },
    );
    expect(failed.kind).toBe("error");
    const ok = await handleInbound(
      src,
      { rawBody: sig.body, headers: sig.headers, method: "POST" },
      { dedup: { ttl: "1h" } },
    );
    expect(ok.kind).toBe("verified");
  });

  it("handler failure releases the dedup record so a retry reaches the handler again", async () => {
    const src = dedupSource();
    const sig = await signed("e");
    const req = { rawBody: sig.body, headers: sig.headers, method: "POST" };

    await expect(
      handleInbound(src, req, {
        dedup: { ttl: "1h" },
        onVerified: () => {
          throw new Error("downstream write failed");
        },
      }),
    ).rejects.toThrow("downstream write failed");

    let ran = false;
    const retry = await handleInbound(src, req, {
      dedup: { ttl: "1h" },
      onVerified: () => {
        ran = true;
      },
    });
    expect(retry.kind).toBe("verified");
    expect(ran).toBe(true);
  });

  it("an adapter without release preserves prior behavior: the id stays recorded on handler failure", async () => {
    const src = Postel({
      inbound: {
        vendor: {
          verify: Secret(SECRET),
          clock: fixedClock(NOW),
          dedup: {
            async record() {
              return { duplicate: false };
            },
            // no `release` — the gate has nothing to call
          },
        },
      },
    }).inbound.vendor;
    const sig = await signed("h");
    const req = { rawBody: sig.body, headers: sig.headers, method: "POST" };

    await expect(
      handleInbound(src, req, {
        dedup: { ttl: "1h" },
        onVerified: () => {
          throw new Error("downstream write failed");
        },
      }),
    ).rejects.toThrow("downstream write failed");
  });

  it("release failure does not mask the handler's error", async () => {
    const src = Postel({
      inbound: {
        vendor: {
          verify: Secret(SECRET),
          clock: fixedClock(NOW),
          dedup: {
            async record() {
              return { duplicate: false };
            },
            async release() {
              throw new Error("release backend unavailable");
            },
          },
        },
      },
    }).inbound.vendor;
    const sig = await signed("f");
    const req = { rawBody: sig.body, headers: sig.headers, method: "POST" };

    await expect(
      handleInbound(src, req, {
        dedup: { ttl: "1h" },
        onVerified: () => {
          throw new Error("downstream write failed");
        },
      }),
    ).rejects.toThrow("downstream write failed");
  });

  it("handler failure is a no-op for an already-answered duplicate", async () => {
    const src = dedupSource();
    const sig = await signed("g");
    const req = { rawBody: sig.body, headers: sig.headers, method: "POST" };

    await handleInbound(src, req, { dedup: { ttl: "1h" } });

    const duplicate = await handleInbound(src, req, {
      dedup: { ttl: "1h" },
      onVerified: () => {
        throw new Error("must not run for a duplicate");
      },
    });
    expect(duplicate.kind).toBe("duplicate");

    // The id is still recorded (a duplicate response never releases): a
    // further attempt is still a duplicate, not a fresh retry.
    const stillDuplicate = await handleInbound(src, req, { dedup: { ttl: "1h" } });
    expect(stillDuplicate.kind).toBe("duplicate");
  });
});
