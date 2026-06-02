import {
  Postel,
  RawBytesMismatchDetected,
  Secret,
  SignatureInvalid,
  signFixture,
} from "@postel/core";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
  POSTEL_CONTEXT_KEY,
  honoAdapter,
  honoVerify,
  postelHono,
  verifyWebhook,
  withWebhook,
} from "../src/index.js";

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

describe("Framework adapters gate verification and map protocol errors to HTTP status", () => {
  function vendor() {
    return Postel({ inbound: { vendor: { verify: Secret(SECRET), now: () => NOW } } });
  }

  it("verifyWebhook middleware verifies, stashes the result, and runs the downstream handler", async () => {
    const signed = await signFixture({
      secret: SECRET,
      payload: { type: "order.created", timestamp: "2026-05-14T12:59:55Z", data: { id: "o_1" } },
      timestamp: NOW,
    });
    const postel = vendor();
    const app = new Hono();
    app.post("/webhooks/vendor", verifyWebhook(postel.inbound.vendor), (c) => {
      const result = c.get(POSTEL_CONTEXT_KEY);
      return c.json({ ok: true, type: result.event.type, matched: result.matchedVerifierIndex });
    });
    const res = await app.request("/webhooks/vendor", {
      method: "POST",
      headers: { ...signed.headers, "content-type": "application/json" },
      body: signed.body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, type: "order.created", matched: 0 });
  });

  it("verifyWebhook rejects a bad signature with 400 and never runs the handler", async () => {
    const signed = await signFixture({
      secret: SECRET,
      payload: { type: "order.created", timestamp: "2026-05-14T12:59:55Z", data: { id: "o_2" } },
      timestamp: NOW,
    });
    const reSerialized = JSON.stringify(JSON.parse(signed.body), null, 2);
    const postel = vendor();
    let ran = false;
    const app = new Hono();
    app.post("/webhooks/vendor", verifyWebhook(postel.inbound.vendor), (c) => {
      ran = true;
      return c.json({ ok: true });
    });
    const res = await app.request("/webhooks/vendor", {
      method: "POST",
      headers: { ...signed.headers, "content-type": "application/json" },
      body: reSerialized,
    });
    expect(res.status).toBe(400);
    expect(ran).toBe(false);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "SIGNATURE_INVALID" },
    });
  });

  it("honoAdapter(postel).verify(key) binds the configured source by key", async () => {
    const signed = await signFixture({
      secret: SECRET,
      payload: { type: "user.created", timestamp: "2026-05-14T12:59:55Z", data: { id: "u_1" } },
      timestamp: NOW,
    });
    const wh = honoAdapter(vendor());
    const app = new Hono();
    app.post("/webhooks/vendor", wh.verify("vendor"), (c) =>
      c.json({ ok: true, type: c.get(POSTEL_CONTEXT_KEY).event.type }),
    );
    const res = await app.request("/webhooks/vendor", {
      method: "POST",
      headers: { ...signed.headers, "content-type": "application/json" },
      body: signed.body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, type: "user.created" });
  });

  it("withWebhook wraps a single handler behind the gate", async () => {
    const signed = await signFixture({
      secret: SECRET,
      payload: { type: "payment.captured", timestamp: "2026-05-14T12:59:55Z", data: { id: "p_1" } },
      timestamp: NOW,
    });
    const app = new Hono();
    app.post(
      "/webhooks/vendor",
      withWebhook(vendor().inbound.vendor, (c) =>
        c.json({ ok: true, type: c.get(POSTEL_CONTEXT_KEY).event.type }),
      ),
    );
    const res = await app.request("/webhooks/vendor", {
      method: "POST",
      headers: { ...signed.headers, "content-type": "application/json" },
      body: signed.body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, type: "payment.captured" });
  });
});

describe("JWKS endpoint mounter", () => {
  it("honoAdapter(postel).jwks(provider) serves the JWKS document on GET", async () => {
    const postel = Postel({ inbound: { vendor: { verify: Secret(SECRET) } } });
    const wh = honoAdapter(postel);
    const app = new Hono();
    app.get(
      "/.well-known/webhooks-keys",
      wh.jwks(() => ({
        keys: [{ kty: "OKP", crv: "Ed25519", x: "Zm9vYmFy", kid: "k1", alg: "EdDSA" }],
      })),
    );
    const res = await app.request("/.well-known/webhooks-keys");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { keys: { kid: string }[] }).keys[0]?.kid).toBe("k1");
  });
});
