import type { StandardSchemaV1 } from "@postel/core";
import { InMemoryStorage, Postel, Secret, signFixture } from "@postel/core";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  FastifyWebAdapter,
  fastifyPostel,
  fetchToFastify,
  getVerified,
  verifyWebhook,
} from "../src/index.js";

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
  it("Fastify adapter preserves bytes via inbound.<source>.post and rejects re-serialized JSON", async () => {
    const app = Fastify();
    FastifyWebAdapter(vendor(), app).inbound.vendor.post("/webhooks/vendor", async (req) => ({
      ok: true,
      type: req.postel.event.type,
    }));

    const sig = await signed("order.created", "o_1");
    const ok = await app.inject({
      method: "POST",
      url: "/webhooks/vendor",
      headers: { ...sig.headers, "content-type": "application/json" },
      payload: sig.body,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, type: "order.created" });

    const reSerialized = JSON.stringify(JSON.parse(sig.body), null, 2);
    const bad = await app.inject({
      method: "POST",
      url: "/webhooks/vendor",
      headers: { ...sig.headers, "content-type": "application/json" },
      payload: reSerialized,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: "SIGNATURE_INVALID" } });
    await app.close();
  });

  it("inbound.<source>.on binds an explicit method (PUT) behind the gate", async () => {
    const app = Fastify();
    FastifyWebAdapter(vendor(), app).inbound.vendor.on("PUT", "/webhooks/vendor", async (req) => ({
      ok: true,
      type: req.postel.event.type,
    }));
    const sig = await signed("order.updated", "o_1");
    const res = await app.inject({
      method: "PUT",
      url: "/webhooks/vendor",
      headers: { ...sig.headers, "content-type": "application/json" },
      payload: sig.body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, type: "order.updated" });
    await app.close();
  });

  it("inbound.<source>.post types req.postel with the source's schema output", async () => {
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
    const app = Fastify();
    FastifyWebAdapter(postel, app).inbound.orders.post("/webhooks/orders", async (req) => {
      // Compile-time proof the handler's req carries the schema's output type.
      const data: { id: string } | undefined = req.postel.event.data;
      return { ok: true, id: data?.id };
    });
    const sig = await signed("order.created", "o_55");
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/orders",
      headers: { ...sig.headers, "content-type": "application/json" },
      payload: sig.body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: "o_55" });
    await app.close();
  });

  it("verifyWebhook remains as a low-level preHandler primitive", async () => {
    const postel = vendor();
    const app = Fastify();
    await app.register(fastifyPostel);
    app.post("/mw/vendor", { preHandler: verifyWebhook(postel.inbound.vendor) }, async (req) => ({
      ok: true,
      type: getVerified(req).event.type,
    }));
    const sig = await signed("user.created", "u_1");
    const res = await app.inject({
      method: "POST",
      url: "/mw/vendor",
      headers: { ...sig.headers, "content-type": "application/json" },
      payload: sig.body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, type: "user.created" });
    await app.close();
  });
});

describe("JWKS endpoint mounter", () => {
  it("outbound.bindJwks() serves the JWKS document on GET (default provider)", async () => {
    const app = Fastify();
    FastifyWebAdapter(
      Postel({ outbound: { storage: InMemoryStorage() } }),
      app,
    ).outbound.bindJwks();
    const res = await app.inject({ method: "GET", url: "/.well-known/webhooks-keys" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().keys)).toBe(true);
    await app.close();
  });

  it("outbound.bindJwks(route, provider) honors a custom route and provider", async () => {
    const app = Fastify();
    FastifyWebAdapter(Postel({ outbound: { storage: InMemoryStorage() } }), app).outbound.bindJwks(
      "/keys",
      () => ({
        keys: [{ kty: "OKP", crv: "Ed25519", x: "Zm9vYmFy", kid: "k1", alg: "EdDSA" }],
      }),
    );
    const res = await app.inject({ method: "GET", url: "/keys" });
    expect(res.statusCode).toBe(200);
    expect(res.json().keys[0].kid).toBe("k1");
    await app.close();
  });
});

describe("Admin router binding", () => {
  it("admin.bindAdminRoutes mounts the admin router under a prefix", async () => {
    const app = Fastify();
    FastifyWebAdapter(
      Postel({ outbound: { storage: InMemoryStorage() } }),
      app,
    ).admin.bindAdminRoutes("/admin", { authorize: () => true });
    const res = await app.inject({ method: "GET", url: "/admin/endpoints" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ endpoints: [], nextCursor: null });
    await app.close();
  });

  it("admin.bindAdminRoutes denies when authorize returns false", async () => {
    const app = Fastify();
    FastifyWebAdapter(
      Postel({ outbound: { storage: InMemoryStorage() } }),
      app,
    ).admin.bindAdminRoutes("/admin", { authorize: () => false });
    const res = await app.inject({ method: "GET", url: "/admin/endpoints" });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("fetchToFastify remains as a low-level Fetch bridge", async () => {
    const app = Fastify();
    app.post(
      "/admin/echo",
      fetchToFastify(
        async (req) =>
          new Response(JSON.stringify({ method: req.method }), {
            status: 201,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const res = await app.inject({
      method: "POST",
      url: "/admin/echo",
      headers: { "content-type": "application/json" },
      payload: { hi: 1 },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { method: string }).method).toBe("POST");
    await app.close();
  });
});

describe("Route options and middleware composition", () => {
  it(".post forwards route options; onRequest runs before the gate, preHandler after", async () => {
    const order: string[] = [];
    let postelAtPreHandler: { event: { type: string } } | undefined;
    const app = Fastify();
    FastifyWebAdapter(vendor(), app).inbound.vendor.post(
      "/webhooks/vendor",
      {
        onRequest: async () => {
          order.push("onRequest");
        },
        preHandler: async (req) => {
          order.push("preHandler");
          postelAtPreHandler = getVerified(req);
        },
      },
      async (req) => {
        order.push("handler");
        return { ok: true, type: req.postel.event.type };
      },
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
    expect(order).toEqual(["onRequest", "preHandler", "handler"]);
    expect(postelAtPreHandler?.event.type).toBe("order.created");
    await app.close();
  });

  it("the gate still rejects a bad signature when route options are supplied", async () => {
    let userPreHandlerRan = false;
    const app = Fastify();
    FastifyWebAdapter(vendor(), app).inbound.vendor.post(
      "/webhooks/vendor",
      {
        preHandler: async () => {
          userPreHandlerRan = true;
        },
      },
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
    expect(userPreHandlerRan).toBe(false);
    await app.close();
  });
});
