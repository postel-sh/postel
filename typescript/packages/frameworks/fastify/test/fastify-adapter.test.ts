import { Postel, Secret, signFixture } from "@postel/core";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { fastifyAdapter, fastifyPostel, verifyWebhook } from "../src/index.js";

const SECRET = "whsec_aG9uby1hZGFwdGVyLXRlc3Qtc2VjcmV0LWZvci1wb3N0ZWw=";
const NOW = new Date("2026-05-14T13:00:00Z");

function vendor() {
  return Postel({ inbound: { vendor: { verify: Secret(SECRET), now: () => NOW } } });
}

function signed(type: string, id: string) {
  return signFixture({
    secret: SECRET,
    payload: { type, timestamp: "2026-05-14T12:59:55Z", data: { id } },
    timestamp: NOW,
  });
}

describe("Framework adapters preserve raw bytes", () => {
  it("Fastify adapter preserves bytes: the buffer content-type parser keeps verify input byte-identical", async () => {
    const postel = vendor();
    const app = Fastify();
    await app.register(fastifyPostel);
    app.post(
      "/webhooks/vendor",
      { preHandler: verifyWebhook(postel.inbound.vendor) },
      async (req) => ({ ok: true, type: req.postel?.event.type }),
    );
    const sig = await signed("order.created", "o_1");
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/vendor",
      headers: { ...sig.headers, "content-type": "application/json" },
      payload: sig.body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, type: "order.created" });
    await app.close();
  });

  it("re-serialized JSON breaks the signature (400)", async () => {
    const postel = vendor();
    const app = Fastify();
    await app.register(fastifyPostel);
    app.post(
      "/webhooks/vendor",
      { preHandler: fastifyAdapter(postel).verify("vendor") },
      async () => ({ ok: true }),
    );
    const sig = await signed("order.created", "o_2");
    const reSerialized = JSON.stringify(JSON.parse(sig.body), null, 2);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/vendor",
      headers: { ...sig.headers, "content-type": "application/json" },
      payload: reSerialized,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "SIGNATURE_INVALID" } });
    await app.close();
  });
});

describe("JWKS endpoint mounter", () => {
  it("fastifyAdapter(postel).jwks(provider) serves the JWKS document on GET", async () => {
    const postel = Postel({ inbound: { vendor: { verify: Secret(SECRET) } } });
    const app = Fastify();
    app.get(
      "/.well-known/webhooks-keys",
      fastifyAdapter(postel).jwks(() => ({
        keys: [{ kty: "OKP", crv: "Ed25519", x: "Zm9vYmFy", kid: "k1", alg: "EdDSA" }],
      })),
    );
    const res = await app.inject({ method: "GET", url: "/.well-known/webhooks-keys" });
    expect(res.statusCode).toBe(200);
    expect(res.json().keys[0].kid).toBe("k1");
    await app.close();
  });
});
