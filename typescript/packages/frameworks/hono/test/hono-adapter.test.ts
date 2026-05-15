import { RawBytesMismatchDetected, SignatureInvalid, signFixture } from "@postel/edge";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { POSTEL_CONTEXT_KEY, honoVerify, postelHono } from "../src/index.js";

const SECRET = "whsec_aG9uby1hZGFwdGVyLXRlc3Qtc2VjcmV0LWZvci1wb3N0ZWw=";
const NOW = new Date("2026-05-14T13:00:00Z");

describe("Framework adapters preserve raw bytes", () => {
  it("honoVerify receives byte-identical bytes sent to the receiver (Hono adapter)", async () => {
    const signed = await signFixture({
      secret: SECRET,
      payload: {
        type: "order.created",
        timestamp: "2026-05-14T12:59:55Z",
        data: { id: "order_1" },
      },
      timestamp: NOW,
    });

    const app = new Hono();
    app.post("/webhooks", async (c) => {
      const result = await honoVerify(c, SECRET, { now: () => NOW });
      return c.json({ ok: true, matched: result.matchedSecretIndex, type: result.event.type });
    });

    const res = await app.request("/webhooks", {
      method: "POST",
      headers: { ...signed.headers, "content-type": "application/json" },
      body: signed.body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, matched: 0, type: "order.created" });
  });

  it("postelHono middleware stashes the VerifyResult on the context", async () => {
    const signed = await signFixture({
      secret: SECRET,
      payload: { type: "user.created", timestamp: "2026-05-14T12:59:55Z", data: { id: "u_2" } },
      timestamp: NOW,
    });

    const app = new Hono();
    app.post("/webhooks", postelHono(SECRET, { now: () => NOW }), (c) => {
      const result = c.get(POSTEL_CONTEXT_KEY);
      return c.json({ ok: true, type: result.event.type });
    });

    const res = await app.request("/webhooks", {
      method: "POST",
      headers: { ...signed.headers, "content-type": "application/json" },
      body: signed.body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, type: "user.created" });
  });

  it("JSON re-serialization breaks the signature (raw-bytes mismatch surfaces as SIGNATURE_INVALID)", async () => {
    const signed = await signFixture({
      secret: SECRET,
      payload: {
        type: "payment.captured",
        timestamp: "2026-05-14T12:59:55Z",
        data: { id: "pay_3" },
      },
      timestamp: NOW,
    });

    const reSerialized = JSON.stringify(JSON.parse(signed.body), null, 2);
    expect(reSerialized).not.toBe(signed.body);

    const app = new Hono();
    app.post("/webhooks", async (c) => {
      try {
        await honoVerify(c, SECRET, { now: () => NOW });
        return c.json({ ok: true });
      } catch (err) {
        if (err instanceof SignatureInvalid || err instanceof RawBytesMismatchDetected) {
          return c.json({ ok: false, code: (err as { code: string }).code }, 400);
        }
        throw err;
      }
    });

    const res = await app.request("/webhooks", {
      method: "POST",
      headers: { ...signed.headers, "content-type": "application/json" },
      body: reSerialized,
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: "SIGNATURE_INVALID" });
  });
});
