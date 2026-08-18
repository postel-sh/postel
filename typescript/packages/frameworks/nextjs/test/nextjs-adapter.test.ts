import type { StandardSchemaV1 } from "@postel/core";
import { InMemoryStorage, Postel, Secret, signFixture } from "@postel/core";
import { describe, expect, it } from "vitest";

import { NextjsWebAdapter, withWebhook } from "../src/index.js";

const fixedClock = (at: Date) => ({ now: () => at, sleep: () => Promise.resolve() });

const SECRET = "whsec_bmV4dGpzLWFkYXB0ZXItdGVzdC1zZWNyZXQtZm9yLXBvc3RlbA==";
const NOW = new Date("2026-05-14T13:00:00Z");
const URL = "http://localhost/webhooks/vendor";

function vendor() {
  return Postel({ inbound: { vendor: { verify: Secret(SECRET), clock: fixedClock(NOW) } } });
}

function signed(type: string, id: string) {
  return signFixture({
    secret: SECRET,
    payload: { type, timestamp: "2026-05-14T12:59:55Z", data: { id } },
    timestamp: NOW,
  });
}

describe("Framework adapters preserve raw bytes", () => {
  it("NextjsWebAdapter inbound routes receive byte-identical input; re-serialized JSON is rejected", async () => {
    const { POST } = NextjsWebAdapter(vendor()).inbound.vendor.post((result) =>
      Response.json({ ok: true, type: result.event.type }),
    );

    const sig = await signed("order.created", "o_1");
    const ok = await POST(
      new Request(URL, {
        method: "POST",
        headers: { ...sig.headers, "content-type": "application/json" },
        body: sig.body,
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, type: "order.created" });

    const reSerialized = JSON.stringify(JSON.parse(sig.body), null, 2);
    expect(reSerialized).not.toBe(sig.body);
    const bad = await POST(
      new Request(URL, {
        method: "POST",
        headers: { ...sig.headers, "content-type": "application/json" },
        body: reSerialized,
      }),
    );
    expect(bad.status).toBe(400);
  });
});

describe("Framework adapters gate verification and map protocol errors to HTTP status", () => {
  it("inbound.<source>.post gates the route, hands the handler the verified result", async () => {
    const { POST } = NextjsWebAdapter(vendor()).inbound.vendor.post((result) =>
      Response.json({ ok: true, type: result.event.type, matched: result.matchedVerifierIndex }),
    );
    const sig = await signed("order.created", "o_1");
    const res = await POST(
      new Request(URL, {
        method: "POST",
        headers: { ...sig.headers, "content-type": "application/json" },
        body: sig.body,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, type: "order.created", matched: 0 });
  });

  it("a bad signature is rejected with 400 and the handler never runs", async () => {
    let ran = false;
    const { POST } = NextjsWebAdapter(vendor()).inbound.vendor.post(() => {
      ran = true;
      return Response.json({ ok: true });
    });
    const sig = await signed("order.created", "o_2");
    const reSerialized = JSON.stringify(JSON.parse(sig.body), null, 2);
    const res = await POST(
      new Request(URL, {
        method: "POST",
        headers: { ...sig.headers, "content-type": "application/json" },
        body: reSerialized,
      }),
    );
    expect(res.status).toBe(400);
    expect(ran).toBe(false);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "SIGNATURE_INVALID" },
    });
  });

  it("inbound.<source>.on binds an explicit method (PUT) behind the gate", async () => {
    const { PUT } = NextjsWebAdapter(vendor()).inbound.vendor.on("PUT", (result) =>
      Response.json({ ok: true, type: result.event.type }),
    );
    const sig = await signed("order.updated", "o_1");
    const res = await PUT(
      new Request(URL, {
        method: "PUT",
        headers: { ...sig.headers, "content-type": "application/json" },
        body: sig.body,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, type: "order.updated" });
  });

  it("inbound.<source>.post types the verified result with the source's schema output", async () => {
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
      inbound: { orders: { verify: Secret(SECRET), schema, clock: fixedClock(NOW) } },
    });
    const { POST } = NextjsWebAdapter(postel).inbound.orders.post((result) => {
      // Compile-time proof the handler receives the schema's output type.
      const data: { id: string } | undefined = result.event.data;
      return Response.json({ ok: true, id: data?.id });
    });
    const sig = await signed("order.created", "o_99");
    const res = await POST(
      new Request("http://localhost/webhooks/orders", {
        method: "POST",
        headers: { ...sig.headers, "content-type": "application/json" },
        body: sig.body,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "o_99" });
  });

  it("withWebhook remains as a low-level primitive", async () => {
    const postel = vendor();
    const handler = withWebhook(postel.inbound.vendor, (result) =>
      Response.json({ ok: true, type: result.event.type }),
    );
    const sig = await signed("user.created", "u_1");
    const res = await handler(
      new Request(URL, {
        method: "POST",
        headers: { ...sig.headers, "content-type": "application/json" },
        body: sig.body,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, type: "user.created" });
  });
});

describe("JWKS endpoint mounter", () => {
  it("outbound.bindJwks() serves the JWKS document at the well-known path (default provider)", async () => {
    const { GET } = NextjsWebAdapter(
      Postel({ outbound: { storage: InMemoryStorage() } }),
    ).outbound.bindJwks();
    const res = await GET(new Request("http://localhost/.well-known/webhooks-keys"));
    expect(res.status).toBe(200);
    expect(Array.isArray(((await res.json()) as { keys: unknown[] }).keys)).toBe(true);
  });

  it("outbound.bindJwks(provider) honors a custom provider", async () => {
    const { GET } = NextjsWebAdapter(
      Postel({ outbound: { storage: InMemoryStorage() } }),
    ).outbound.bindJwks(() => ({
      keys: [{ kty: "OKP", crv: "Ed25519", x: "Zm9vYmFy", kid: "k1", alg: "EdDSA" }],
    }));
    const res = await GET(new Request("http://localhost/keys"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { keys: { kid: string }[] }).keys[0]?.kid).toBe("k1");
  });
});

describe("Admin router binding", () => {
  it("admin.bindAdminRoutes mounts the admin router", async () => {
    const { GET } = NextjsWebAdapter(
      Postel({ outbound: { storage: InMemoryStorage() } }),
    ).admin.bindAdminRoutes({ authorize: () => true });
    const res = await GET(new Request("http://localhost/admin/endpoints"));
    expect(res.status).toBe(200);
    expect((await res.json()) as { endpoints: unknown[] }).toEqual({
      endpoints: [],
      nextCursor: null,
    });
  });

  it("admin.bindAdminRoutes denies when authorize returns false", async () => {
    const { GET } = NextjsWebAdapter(
      Postel({ outbound: { storage: InMemoryStorage() } }),
    ).admin.bindAdminRoutes({ authorize: () => false });
    const res = await GET(new Request("http://localhost/admin/endpoints"));
    expect(res.status).toBe(403);
  });
});
