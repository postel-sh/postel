import type { StandardSchemaV1 } from "@postel/core";
import { InMemoryStorage, Postel, Secret, signFixture } from "@postel/core";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { HonoWebAdapter, getVerified, verifyWebhook, withWebhook } from "../src/index.js";

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
  it("HonoWebAdapter inbound routes receive byte-identical input; re-serialized JSON is rejected", async () => {
    const app = new Hono();
    HonoWebAdapter(vendor(), app).inbound.vendor.post("/webhooks/vendor", (c) =>
      c.json({ ok: true, type: c.var.postel.event.type }),
    );

    const sig = await signed("order.created", "o_1");
    const ok = await app.request("/webhooks/vendor", {
      method: "POST",
      headers: { ...sig.headers, "content-type": "application/json" },
      body: sig.body,
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, type: "order.created" });

    const reSerialized = JSON.stringify(JSON.parse(sig.body), null, 2);
    expect(reSerialized).not.toBe(sig.body);
    const bad = await app.request("/webhooks/vendor", {
      method: "POST",
      headers: { ...sig.headers, "content-type": "application/json" },
      body: reSerialized,
    });
    expect(bad.status).toBe(400);
  });
});

describe("Framework adapters gate verification and map protocol errors to HTTP status", () => {
  it("inbound.<source>.post gates the route, stashes the verified result, runs the handler", async () => {
    const app = new Hono();
    HonoWebAdapter(vendor(), app).inbound.vendor.post("/webhooks/vendor", (c) => {
      const result = c.var.postel;
      return c.json({ ok: true, type: result.event.type, matched: result.matchedVerifierIndex });
    });
    const sig = await signed("order.created", "o_1");
    const res = await app.request("/webhooks/vendor", {
      method: "POST",
      headers: { ...sig.headers, "content-type": "application/json" },
      body: sig.body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, type: "order.created", matched: 0 });
  });

  it("a bad signature is rejected with 400 and the handler never runs", async () => {
    let ran = false;
    const app = new Hono();
    HonoWebAdapter(vendor(), app).inbound.vendor.post("/webhooks/vendor", (c) => {
      ran = true;
      return c.json({ ok: true });
    });
    const sig = await signed("order.created", "o_2");
    const reSerialized = JSON.stringify(JSON.parse(sig.body), null, 2);
    const res = await app.request("/webhooks/vendor", {
      method: "POST",
      headers: { ...sig.headers, "content-type": "application/json" },
      body: reSerialized,
    });
    expect(res.status).toBe(400);
    expect(ran).toBe(false);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "SIGNATURE_INVALID" },
    });
  });

  it("inbound.<source>.on binds an explicit method (PUT) behind the gate", async () => {
    const app = new Hono();
    HonoWebAdapter(vendor(), app).inbound.vendor.on("PUT", "/webhooks/vendor", (c) =>
      c.json({ ok: true, type: c.var.postel.event.type }),
    );
    const sig = await signed("order.updated", "o_1");
    const res = await app.request("/webhooks/vendor", {
      method: "PUT",
      headers: { ...sig.headers, "content-type": "application/json" },
      body: sig.body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, type: "order.updated" });
  });

  it("inbound.<source>.post types c.var.postel with the source's schema output", async () => {
    const schema: StandardSchemaV1<unknown, { id: string }> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value) =>
          typeof value === "object" &&
          value !== null &&
          typeof (value as { id?: unknown }).id === "string"
            ? { value: value as { id: string } }
            : { issues: [{ message: "id must be a string" }] },
      },
    };
    const postel = Postel({
      inbound: { orders: { verify: Secret(SECRET), schema, now: () => NOW } },
    });
    const app = new Hono();
    HonoWebAdapter(postel, app).inbound.orders.post("/webhooks/orders", (c) => {
      // Compile-time proof the handler context carries the schema's output type.
      const data: { id: string } | undefined = c.var.postel.event.data;
      return c.json({ ok: true, id: data?.id });
    });
    const sig = await signed("order.created", "o_99");
    const res = await app.request("/webhooks/orders", {
      method: "POST",
      headers: { ...sig.headers, "content-type": "application/json" },
      body: sig.body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "o_99" });
  });

  it("verifyWebhook / withWebhook remain as low-level primitives", async () => {
    const postel = vendor();
    const app = new Hono();
    app.post("/mw/vendor", verifyWebhook(postel.inbound.vendor), (c) =>
      c.json({ ok: true, type: getVerified(c).event.type }),
    );
    app.post(
      "/wrap/vendor",
      withWebhook(postel.inbound.vendor, (c) =>
        c.json({ ok: true, type: getVerified(c).event.type }),
      ),
    );
    for (const path of ["/mw/vendor", "/wrap/vendor"]) {
      const sig = await signed("user.created", "u_1");
      const res = await app.request(path, {
        method: "POST",
        headers: { ...sig.headers, "content-type": "application/json" },
        body: sig.body,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, type: "user.created" });
    }
  });
});

describe("JWKS endpoint mounter", () => {
  it("outbound.bindJwks() serves the JWKS document at the well-known path (default provider)", async () => {
    const app = new Hono();
    HonoWebAdapter(Postel({ outbound: { storage: InMemoryStorage() } }), app).outbound.bindJwks();
    const res = await app.request("/.well-known/webhooks-keys");
    expect(res.status).toBe(200);
    expect(Array.isArray(((await res.json()) as { keys: unknown[] }).keys)).toBe(true);
  });

  it("outbound.bindJwks(route, provider) honors a custom route and provider", async () => {
    const app = new Hono();
    HonoWebAdapter(Postel({ outbound: { storage: InMemoryStorage() } }), app).outbound.bindJwks(
      "/keys",
      () => ({ keys: [{ kty: "OKP", crv: "Ed25519", x: "Zm9vYmFy", kid: "k1", alg: "EdDSA" }] }),
    );
    const res = await app.request("/keys");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { keys: { kid: string }[] }).keys[0]?.kid).toBe("k1");
  });
});

describe("Admin router binding", () => {
  it("admin.bindAdminRoutes mounts the admin router under a prefix", async () => {
    const app = new Hono();
    HonoWebAdapter(Postel({ outbound: { storage: InMemoryStorage() } }), app).admin.bindAdminRoutes(
      "/admin",
      { authorize: () => true },
    );
    const res = await app.request("/admin/endpoints");
    expect(res.status).toBe(200);
    expect((await res.json()) as { endpoints: unknown[] }).toEqual({
      endpoints: [],
      nextCursor: null,
    });
  });

  it("admin.bindAdminRoutes denies when authorize returns false", async () => {
    const app = new Hono();
    HonoWebAdapter(Postel({ outbound: { storage: InMemoryStorage() } }), app).admin.bindAdminRoutes(
      "/admin",
      { authorize: () => false },
    );
    const res = await app.request("/admin/endpoints");
    expect(res.status).toBe(403);
  });
});
