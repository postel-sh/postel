import { Postel, Secret, inMemoryDedupAdapter, signFixture } from "@postel/core";
import { describe, expect, it } from "vitest";

import { handleInbound } from "../src/index.js";

const fixedClock = (at: Date) => ({ now: () => at, sleep: () => Promise.resolve() });

const SECRET = "whsec_aG9uby1hZGFwdGVyLXRlc3Qtc2VjcmV0LWZvci1wb3N0ZWw=";
const NOW = new Date("2026-05-14T13:00:00Z");

function dedupSource() {
  return Postel({
    inbound: {
      vendor: { verify: Secret(SECRET), clock: fixedClock(NOW), dedup: inMemoryDedupAdapter() },
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
});
