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

  it("Read a message and its attempts via admin router: GET /messages/:id and /attempts", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage, ...SSRF } });
    const router = adminRouter(postel, ALLOW);
    const messageId = await postel.outbound.send({ type: "order.created", data: { id: "o1" } });
    await storage.recordAttempt({
      id: "att_admin_1",
      messageId,
      endpointId: "ep_1",
      tenantId: null,
      attemptNumber: 1,
      status: "success",
      scheduledFor: null,
      startedAt: new Date(),
      completedAt: new Date(),
      responseCode: 200,
      responseHeaders: null,
      responseBody: null,
      latencyMs: 8,
      error: null,
      replayOf: null,
    });

    const got = await router(req("GET", `/admin/messages/${messageId}`));
    expect(got.status).toBe(200);
    const msg = (await got.json()) as { id: string; type: string; data: { id: string } };
    expect(msg.id).toBe(messageId);
    expect(msg.type).toBe("order.created");
    expect(msg.data).toEqual({ id: "o1" });

    const attempts = await router(req("GET", `/admin/messages/${messageId}/attempts`));
    expect(attempts.status).toBe(200);
    const body = (await attempts.json()) as {
      attempts: Array<{ status: string; responseCode: number; latencyMs: number }>;
    };
    expect(body.attempts[0]?.status).toBe("success");
    expect(body.attempts[0]?.responseCode).toBe(200);
    expect(body.attempts[0]?.latencyMs).toBe(8);
  });

  it("Filter attempts by status via admin router: ?status= returns only matching attempts", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage, ...SSRF } });
    const router = adminRouter(postel, ALLOW);
    const messageId = await postel.outbound.send({ type: "order.created", data: { id: "o1" } });
    const base = {
      messageId,
      endpointId: "ep_1",
      tenantId: null,
      scheduledFor: null,
      startedAt: new Date(),
      completedAt: new Date(),
      responseHeaders: null,
      responseBody: null,
      error: null,
      replayOf: null,
    };
    await storage.recordAttempt({
      ...base,
      id: "att_f_1",
      attemptNumber: 1,
      status: "failed",
      responseCode: 500,
      latencyMs: 12,
    });
    await storage.recordAttempt({
      ...base,
      id: "att_f_2",
      attemptNumber: 2,
      status: "success",
      responseCode: 200,
      latencyMs: 9,
    });

    const filtered = await router(
      req("GET", `/admin/messages/${messageId}/attempts?status=failed`),
    );
    expect(filtered.status).toBe(200);
    const body = (await filtered.json()) as { attempts: Array<{ status: string }> };
    expect(body.attempts).toHaveLength(1);
    expect(body.attempts[0]?.status).toBe("failed");

    const csv = await router(
      req("GET", `/admin/messages/${messageId}/attempts?status=failed,success`),
    );
    expect(((await csv.json()) as { attempts: unknown[] }).attempts).toHaveLength(2);

    const none = await router(req("GET", `/admin/messages/${messageId}/attempts?status=bogus`));
    expect(none.status).toBe(200);
    expect(((await none.json()) as { attempts: unknown[] }).attempts).toHaveLength(0);
  });

  it("Read of an unknown message maps to 404 (MESSAGE_NOT_FOUND)", async () => {
    const { router } = build(ALLOW);
    const res = await router(req("GET", "/admin/messages/msg_nope"));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("MESSAGE_NOT_FOUND");
  });

  it("List messages via admin router: GET /messages filters by type and limit", async () => {
    const { postel, router } = build(ALLOW);
    await postel.outbound.send({ type: "order.created", data: { id: "a" } });
    await postel.outbound.send({ type: "order.created", data: { id: "b" } });
    await postel.outbound.send({ type: "user.deleted" });

    const res = await router(req("GET", "/admin/messages?type=order.created&limit=50"));
    expect(res.status).toBe(200);
    const { messages } = (await res.json()) as { messages: Array<{ type: string }> };
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.type === "order.created")).toBe(true);
  });

  it("Tenant-scoped admin: a tenant-bound caller cannot read another tenant's message (404, no leak)", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage, ...SSRF, defaultTenantId: "t_2" } });
    const messageId = await postel.outbound.send({ type: "order.created", data: { id: "o1" } });
    const asT1 = adminRouter(postel, { authorize: () => ({ allow: true, tenantId: "t_1" }) });
    const res = await asT1(req("GET", `/admin/messages/${messageId}`));
    expect(res.status).toBe(404);
  });

  it("List messages rejects malformed query params with 400 (not 500)", async () => {
    const { router } = build(ALLOW);
    const badSince = await router(req("GET", "/admin/messages?since=not-a-date"));
    expect(badSince.status).toBe(400);
    expect(((await badSince.json()) as { errorCode: string }).errorCode).toBe("INVALID_QUERY");

    for (const bad of ["-1", "0", "1.5", "abc"]) {
      const res = await router(req("GET", `/admin/messages?limit=${bad}`));
      expect(res.status).toBe(400);
    }

    // A well-formed query still succeeds.
    const ok = await router(req("GET", "/admin/messages?since=2026-06-01T00:00:00Z&limit=10"));
    expect(ok.status).toBe(200);
  });

  it("Read a tenant via admin router: GET /tenants/:id", async () => {
    const { postel, router } = build(ALLOW);
    await postel.outbound.tenants.setRateLimit("t_1", { perSecond: 50 });

    const res = await router(req("GET", "/admin/tenants/t_1"));
    expect(res.status).toBe(200);
    const tenant = (await res.json()) as { id: string; rateLimit: { perSecond: number } };
    expect(tenant.id).toBe("t_1");
    expect(tenant.rateLimit).toEqual({ kind: "fixed", perSecond: 50 });
  });

  it("Read of an unknown tenant maps to 404 (TENANT_NOT_FOUND)", async () => {
    const { router } = build(ALLOW);
    const res = await router(req("GET", "/admin/tenants/t_nope"));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("TENANT_NOT_FOUND");
  });

  it("Tenant-scoped admin: a tenant-bound caller cannot read another tenant (404, no leak)", async () => {
    const { postel, router } = build(ALLOW);
    await postel.outbound.tenants.setRateLimit("t_2", { perSecond: 10 });
    const asT1 = adminRouter(postel, { authorize: () => ({ allow: true, tenantId: "t_1" }) });
    const res = await asT1(req("GET", "/admin/tenants/t_2"));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("TENANT_NOT_FOUND");
  });

  it("List tenants via admin router: GET /tenants paginates newest-first", async () => {
    const { postel, router } = build(ALLOW);
    await postel.outbound.tenants.setRateLimit("t_1", { perSecond: 1 });
    await postel.outbound.tenants.setRateLimit("t_2", { perSecond: 2 });
    await postel.outbound.tenants.setRateLimit("t_3", { perSecond: 3 });

    const res = await router(req("GET", "/admin/tenants?limit=2"));
    expect(res.status).toBe(200);
    const { tenants, nextCursor } = (await res.json()) as {
      tenants: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(tenants).toHaveLength(2);
    expect(nextCursor).not.toBeNull();

    const second = await router(req("GET", `/admin/tenants?limit=2&cursor=${nextCursor}`));
    const body2 = (await second.json()) as { tenants: Array<{ id: string }>; nextCursor: null };
    expect(body2.tenants).toHaveLength(1);
    expect(body2.nextCursor).toBeNull();
  });

  it("A tenant-bound caller listing tenants sees only its own tenant", async () => {
    const { postel, router } = build(ALLOW);
    await postel.outbound.tenants.setRateLimit("t_1", { perSecond: 1 });
    await postel.outbound.tenants.setRateLimit("t_2", { perSecond: 2 });
    const asT1 = adminRouter(postel, { authorize: () => ({ allow: true, tenantId: "t_1" }) });

    const res = await asT1(req("GET", "/admin/tenants"));
    expect(res.status).toBe(200);
    const { tenants, nextCursor } = (await res.json()) as {
      tenants: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(tenants.map((t) => t.id)).toEqual(["t_1"]);
    expect(nextCursor).toBeNull();
  });

  it("List tenants rejects a malformed limit or cursor with 400 (not 500)", async () => {
    const { router } = build(ALLOW);
    for (const bad of ["-1", "0", "1.5", "abc"]) {
      const res = await router(req("GET", `/admin/tenants?limit=${bad}`));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { errorCode: string }).errorCode).toBe("INVALID_QUERY");
    }

    const badCursor = await router(req("GET", "/admin/tenants?cursor=not-a-valid-cursor"));
    expect(badCursor.status).toBe(400);
    expect(((await badCursor.json()) as { errorCode: string }).errorCode).toBe("INVALID_QUERY");
  });
});
