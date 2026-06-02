import { InMemoryStorage, Postel } from "@postel/core";
import { describe, expect, it } from "vitest";

import { type AdminRouterOptions, adminRouter } from "../src/index.js";

const SSRF = { http: { ssrf: { allowedRanges: ["127.0.0.0/8"] } } };

function build(opts: AdminRouterOptions) {
  const storage = InMemoryStorage();
  const postel = Postel({ outbound: { storage, ...SSRF } });
  return { postel, router: adminRouter(postel, opts) };
}

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`https://admin.test${path}`, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
}

const ALLOW: AdminRouterOptions = { authorize: () => true };

describe("Admin authorization predicate", () => {
  it("default-deny: with no authorize hook configured, every request is 403", async () => {
    const storage = InMemoryStorage();
    const router = adminRouter(Postel({ outbound: { storage, ...SSRF } }));
    const res = await router(req("GET", "/admin/endpoints"));
    expect(res.status).toBe(403);
  });

  it("a denied authorize decision short-circuits before any outbound call", async () => {
    const { router } = build({ authorize: () => ({ allow: false, status: 401 }) });
    const res = await router(req("GET", "/admin/endpoints"));
    expect(res.status).toBe(401);
  });

  it("Tenant-scoped admin: a tenant-bound caller cannot read another tenant's endpoint (404, no leak)", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage, ...SSRF } });
    const asT2 = adminRouter(postel, { authorize: () => ({ allow: true, tenantId: "t_2" }) });
    const created = await asT2(
      req("POST", "/admin/endpoints", { url: "http://127.0.0.1:65535/hook", allowHttp: true }),
    );
    const { id } = (await created.json()) as { id: string };

    const asT1 = adminRouter(postel, { authorize: () => ({ allow: true, tenantId: "t_1" }) });
    const res = await asT1(req("GET", `/admin/endpoints/${id}`));
    expect(res.status).toBe(404);
  });
});

describe("Admin HTTP handlers", () => {
  it("create, list, and get endpoints through the router", async () => {
    const { router } = build(ALLOW);
    const created = await router(
      req("POST", "/admin/endpoints", { url: "http://127.0.0.1:65535/hook", allowHttp: true }),
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(id).toMatch(/^ep_/);

    const list = await router(req("GET", "/admin/endpoints"));
    expect(list.status).toBe(200);
    expect(((await list.json()) as { endpoints: unknown[] }).endpoints).toHaveLength(1);

    const got = await router(req("GET", `/admin/endpoints/${id}`));
    expect(got.status).toBe(200);
    expect(((await got.json()) as { id: string }).id).toBe(id);
  });

  it("a missing endpoint id maps to 404 (EndpointNotFound)", async () => {
    const { router } = build(ALLOW);
    const res = await router(req("GET", "/admin/endpoints/ep_does_not_exist"));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("ENDPOINT_NOT_FOUND");
  });

  it("an invalid create (http without allowHttp) maps to 422 (EndpointValidation)", async () => {
    const { router } = build(ALLOW);
    const res = await router(req("POST", "/admin/endpoints", { url: "http://example.com/hook" }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("ENDPOINT_VALIDATION");
  });

  it("Replay via admin handler: POST /admin/replay re-enqueues by messageId", async () => {
    const { postel, router } = build(ALLOW);
    const messageId = await postel.outbound.send({ type: "order.created", data: { id: "o1" } });
    const res = await router(req("POST", "/admin/replay", { messageId, freshWebhookId: false }));
    expect(res.status).toBe(200);
    expect(typeof ((await res.json()) as { enqueued: number }).enqueued).toBe("number");
  });

  it("generates a symmetric key via /admin/keys/symmetric", async () => {
    const { router } = build(ALLOW);
    const res = await router(req("POST", "/admin/keys/symmetric"));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { secret: string }).secret).toMatch(/^whsec_/);
  });
});
