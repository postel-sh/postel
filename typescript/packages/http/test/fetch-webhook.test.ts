import { Postel, Secret, signFixture } from "@postel/core";
import { describe, expect, it } from "vitest";

import { fetchWebhook } from "../src/index.js";

const fixedClock = (at: Date) => ({ now: () => at, sleep: () => Promise.resolve() });

const SECRET = "whsec_aG9uby1hZGFwdGVyLXRlc3Qtc2VjcmV0LWZvci1wb3N0ZWw=";
const NOW = new Date("2026-05-14T13:00:00Z");

function source() {
  return Postel({ inbound: { vendor: { verify: Secret(SECRET), clock: fixedClock(NOW) } } }).inbound
    .vendor;
}

describe("Framework adapters preserve raw bytes", () => {
  it("fetchWebhook passes byte-identical bytes to verify and runs the handler", async () => {
    const sig = await signFixture({
      secret: SECRET,
      payload: { type: "order.created", timestamp: "2026-05-14T12:59:55Z", data: { id: "o_1" } },
      timestamp: NOW,
    });
    let seen = "";
    const handler = fetchWebhook(source(), {
      onVerified: ({ event }) => {
        seen = event.type;
      },
    });
    const res = await handler(
      new Request("https://example.test/webhooks", {
        method: "POST",
        headers: { ...sig.headers, "content-type": "application/json" },
        body: sig.body,
      }),
    );
    expect(res.status).toBe(204);
    expect(seen).toBe("order.created");
  });

  it("fetchWebhook surfaces a re-serialized body as 400 SIGNATURE_INVALID", async () => {
    const sig = await signFixture({
      secret: SECRET,
      payload: { type: "payment.captured", timestamp: "2026-05-14T12:59:55Z", data: { id: "p_1" } },
      timestamp: NOW,
    });
    const reSerialized = JSON.stringify(JSON.parse(sig.body), null, 2);
    const handler = fetchWebhook(source());
    const res = await handler(
      new Request("https://example.test/webhooks", {
        method: "POST",
        headers: { ...sig.headers, "content-type": "application/json" },
        body: reSerialized,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "SIGNATURE_INVALID" },
    });
  });
});
