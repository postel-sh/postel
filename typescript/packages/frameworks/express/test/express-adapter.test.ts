import { InMemoryStorage, Postel, Secret, signFixture } from "@postel/core";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { ExpressWebAdapter, fetchToExpress, verifyWebhook } from "../src/index.js";

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
  it("Express adapter preserves bytes via inbound.<source>.post and rejects re-serialized JSON", async () => {
    const app = express();
    ExpressWebAdapter(vendor(), app).inbound.vendor.post("/webhooks/vendor", (req, res) => {
      res.json({ ok: true, type: req.postel?.event.type });
    });

    const sig = await signed("order.created", "o_1");
    const ok = await request(app)
      .post("/webhooks/vendor")
      .set(sig.headers)
      .set("content-type", "application/json")
      .send(sig.body);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, type: "order.created" });

    const reSerialized = JSON.stringify(JSON.parse(sig.body), null, 2);
    const bad = await request(app)
      .post("/webhooks/vendor")
      .set(sig.headers)
      .set("content-type", "application/json")
      .send(reSerialized);
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: { code: "SIGNATURE_INVALID" } });
  });

  it("verifyWebhook remains as a low-level middleware primitive", async () => {
    const postel = vendor();
    const app = express();
    app.post("/mw/vendor", verifyWebhook(postel.inbound.vendor), (req, res) => {
      res.json({ ok: true, type: req.postel?.event.type });
    });
    const sig = await signed("user.created", "u_1");
    const res = await request(app)
      .post("/mw/vendor")
      .set(sig.headers)
      .set("content-type", "application/json")
      .send(sig.body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, type: "user.created" });
  });
});

describe("JWKS endpoint mounter", () => {
  it("outbound.bindJwks() serves the JWKS document on GET (default provider)", async () => {
    const app = express();
    ExpressWebAdapter(
      Postel({ outbound: { storage: InMemoryStorage() } }),
      app,
    ).outbound.bindJwks();
    const res = await request(app).get("/.well-known/webhooks-keys");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.keys)).toBe(true);
  });

  it("outbound.bindJwks(route, provider) honors a custom route and provider", async () => {
    const app = express();
    ExpressWebAdapter(Postel({ outbound: { storage: InMemoryStorage() } }), app).outbound.bindJwks(
      "/keys",
      () => ({
        keys: [{ kty: "OKP", crv: "Ed25519", x: "Zm9vYmFy", kid: "k1", alg: "EdDSA" }],
      }),
    );
    const res = await request(app).get("/keys");
    expect(res.status).toBe(200);
    expect(res.body.keys[0].kid).toBe("k1");
  });
});

describe("Admin router binding", () => {
  it("admin.bindAdminRoutes mounts the admin router under a prefix", async () => {
    const app = express();
    ExpressWebAdapter(
      Postel({ outbound: { storage: InMemoryStorage() } }),
      app,
    ).admin.bindAdminRoutes("/admin", { authorize: () => true });
    const res = await request(app).get("/admin/endpoints");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ endpoints: [] });
  });

  it("admin.bindAdminRoutes denies when authorize returns false", async () => {
    const app = express();
    ExpressWebAdapter(
      Postel({ outbound: { storage: InMemoryStorage() } }),
      app,
    ).admin.bindAdminRoutes("/admin", { authorize: () => false });
    const res = await request(app).get("/admin/endpoints");
    expect(res.status).toBe(403);
  });

  it("fetchToExpress remains as a low-level Fetch bridge", async () => {
    const app = express();
    app.post(
      "/admin/echo",
      fetchToExpress(
        async (req) =>
          new Response(JSON.stringify({ method: req.method }), {
            status: 201,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const res = await request(app)
      .post("/admin/echo")
      .set("content-type", "application/json")
      .send(JSON.stringify({ hi: 1 }));
    expect(res.status).toBe(201);
    expect(res.body.method).toBe("POST");
  });
});
