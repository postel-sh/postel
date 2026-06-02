import { Postel, Secret, signFixture } from "@postel/core";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { expressAdapter, fetchToExpress, verifyWebhook } from "../src/index.js";

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
  it("Express adapter preserves bytes: verifyWebhook receives byte-identical input and runs the handler", async () => {
    const postel = vendor();
    const app = express();
    app.post("/webhooks/vendor", verifyWebhook(postel.inbound.vendor), (req, res) => {
      res.json({ ok: true, type: req.postel?.event.type });
    });
    const sig = await signed("order.created", "o_1");
    const res = await request(app)
      .post("/webhooks/vendor")
      .set(sig.headers)
      .set("content-type", "application/json")
      .send(sig.body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, type: "order.created" });
  });

  it("re-serialized JSON breaks the signature (400) and the handler never runs", async () => {
    const postel = vendor();
    let ran = false;
    const app = express();
    app.post("/webhooks/vendor", expressAdapter(postel).verify("vendor"), (_req, res) => {
      ran = true;
      res.json({ ok: true });
    });
    const sig = await signed("order.created", "o_2");
    const reSerialized = JSON.stringify(JSON.parse(sig.body), null, 2);
    const res = await request(app)
      .post("/webhooks/vendor")
      .set(sig.headers)
      .set("content-type", "application/json")
      .send(reSerialized);
    expect(res.status).toBe(400);
    expect(ran).toBe(false);
    expect(res.body).toMatchObject({ error: { code: "SIGNATURE_INVALID" } });
  });
});

describe("JWKS endpoint mounter", () => {
  it("expressAdapter(postel).jwks(provider) serves the JWKS document on GET", async () => {
    const postel = Postel({ inbound: { vendor: { verify: Secret(SECRET) } } });
    const app = express();
    app.get(
      "/.well-known/webhooks-keys",
      expressAdapter(postel).jwks(() => ({
        keys: [{ kty: "OKP", crv: "Ed25519", x: "Zm9vYmFy", kid: "k1", alg: "EdDSA" }],
      })),
    );
    const res = await request(app).get("/.well-known/webhooks-keys");
    expect(res.status).toBe(200);
    expect(res.body.keys[0].kid).toBe("k1");
  });
});

describe("Admin HTTP handlers", () => {
  it("fetchToExpress bridges a Fetch handler (method, body, response) onto Express", async () => {
    const app = express();
    app.post(
      "/admin/echo",
      fetchToExpress(async (request) => {
        const body = await request.text();
        return new Response(JSON.stringify({ method: request.method, body }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const res = await request(app)
      .post("/admin/echo")
      .set("content-type", "application/json")
      .send(JSON.stringify({ hi: 1 }));
    expect(res.status).toBe(201);
    expect(res.body.method).toBe("POST");
    expect(JSON.parse(res.body.body)).toEqual({ hi: 1 });
  });
});
