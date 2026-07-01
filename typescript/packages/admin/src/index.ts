import {
  EndpointNotFound,
  EndpointValidation,
  ExponentialBackoff,
  LinearBackoff,
  PostelError,
  type PostelErrorCode,
} from "@postel/core";
import type {
  Endpoint,
  EndpointCreateOptions,
  EndpointUpdateOptions,
  Message,
  MessageListOptions,
  MessageStatus,
  OutboundApi,
  ReplayOptions,
  RetryStrategy,
} from "@postel/core";

export interface AuthDecision {
  readonly allow: boolean;
  readonly status?: number;
  readonly tenantId?: string;
}

export interface AdminRouterOptions {
  readonly authorize?: (req: Request) => boolean | AuthDecision | Promise<boolean | AuthDecision>;
  readonly resolveTenant?: (req: Request) => string | undefined;
}

export interface AdminHost {
  readonly outbound: OutboundApi;
}

interface AdminBody {
  url?: unknown;
  types?: unknown;
  channels?: unknown;
  headers?: unknown;
  metadata?: unknown;
  allowHttp?: unknown;
  maxInflight?: unknown;
  retryPolicy?: unknown;
  tenantId?: unknown;
  keepPreviousFor?: unknown;
  freshWebhookId?: unknown;
  messageId?: unknown;
  endpointId?: unknown;
  since?: unknown;
  until?: unknown;
  perSecond?: unknown;
}

const STATUS_BY_CODE: Record<PostelErrorCode, number> = {
  ENDPOINT_NOT_FOUND: 404,
  ENDPOINT_VALIDATION: 422,
  SSRF_BLOCKED: 400,
  ENDPOINT_DISABLED: 409,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  MIGRATION_REQUIRED: 503,
  SIGNATURE_INVALID: 400,
  TIMESTAMP_TOO_OLD: 400,
  MALFORMED_HEADER: 400,
  UNKNOWN_KEY_ID: 401,
  RAW_BYTES_MISMATCH_DETECTED: 400,
  EVENT_VALIDATION: 422,
};

let warnedNoAuthorize = false;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readJson(req: Request): Promise<AdminBody> {
  try {
    const value = await req.json();
    return value !== null && typeof value === "object" ? (value as AdminBody) : {};
  } catch {
    return {};
  }
}

function normalizeRetryPolicy(raw: unknown): RetryStrategy | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const obj = raw as {
    schedule?: ReadonlyArray<string | number>;
    step?: string | number;
    jitter?: number;
    maxAttempts?: number;
  };
  if (Array.isArray(obj.schedule)) {
    return ExponentialBackoff({
      schedule: obj.schedule,
      ...(obj.jitter !== undefined ? { jitter: obj.jitter } : {}),
      ...(obj.maxAttempts !== undefined ? { maxAttempts: obj.maxAttempts } : {}),
    });
  }
  if (obj.step !== undefined && obj.maxAttempts !== undefined) {
    return LinearBackoff({ step: obj.step, maxAttempts: obj.maxAttempts });
  }
  return undefined;
}

// Only JSON-representable, data-shaped fields are accepted over HTTP. Function
// fields (filter / transform / callable headers) cannot cross the wire and are
// never read from the body.
function endpointFields(body: AdminBody, tenantId: string | undefined): EndpointUpdateOptions {
  const opts: { -readonly [K in keyof EndpointCreateOptions]?: EndpointCreateOptions[K] } = {};
  if (typeof body.url === "string") opts.url = body.url;
  if (Array.isArray(body.types)) opts.types = body.types as string[];
  if (Array.isArray(body.channels)) opts.channels = body.channels as string[];
  if (body.headers !== null && typeof body.headers === "object" && !Array.isArray(body.headers)) {
    opts.headers = body.headers as Record<string, string>;
  }
  if (
    body.metadata !== null &&
    typeof body.metadata === "object" &&
    !Array.isArray(body.metadata)
  ) {
    opts.metadata = body.metadata as Record<string, unknown>;
  }
  if (typeof body.allowHttp === "boolean") opts.allowHttp = body.allowHttp;
  if (typeof body.maxInflight === "number") opts.maxInflight = body.maxInflight;
  const retryPolicy = normalizeRetryPolicy(body.retryPolicy);
  if (retryPolicy !== undefined) opts.retryPolicy = retryPolicy;
  // Tenant scoping is authorize-derived; the body's tenantId is never trusted
  // when the caller is bound to a tenant.
  if (tenantId !== undefined) opts.tenantId = tenantId;
  else if (typeof body.tenantId === "string") opts.tenantId = body.tenantId;
  return opts;
}

function replayOptionsFromBody(body: AdminBody): ReplayOptions {
  const freshWebhookId = body.freshWebhookId === true;
  if (typeof body.messageId === "string") {
    return { messageId: body.messageId, freshWebhookId };
  }
  if (typeof body.endpointId === "string" && body.since !== undefined) {
    return {
      endpointId: body.endpointId,
      since: String(body.since),
      ...(body.until !== undefined ? { until: String(body.until) } : {}),
      ...(Array.isArray(body.types) ? { types: body.types as string[] } : {}),
      freshWebhookId,
    };
  }
  throw new EndpointValidation("replay requires { messageId } or { endpointId, since }");
}

export function adminRouter(
  host: AdminHost,
  opts: AdminRouterOptions = {},
): (req: Request) => Promise<Response> {
  const out = host.outbound;

  async function endpointForTenant(id: string, tenantId: string | undefined): Promise<Endpoint> {
    const ep = await out.endpoints.get(id);
    if (tenantId !== undefined && ep.tenantId !== tenantId) {
      throw new EndpointNotFound(`endpoint not found: ${id}`);
    }
    return ep;
  }

  // A cross-tenant read resolves as not-found rather than leaking existence.
  async function messageForTenant(
    id: string,
    tenantId: string | undefined,
  ): Promise<Message | undefined> {
    const msg = await out.messages.get(id);
    if (!msg || (tenantId !== undefined && msg.tenantId !== tenantId)) return undefined;
    return msg;
  }

  function csvParam(url: URL, key: string): string[] {
    return url.searchParams
      .getAll(key)
      .flatMap((v) => v.split(","))
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }

  async function dispatch(req: Request, tenantId: string | undefined): Promise<Response> {
    const method = req.method.toUpperCase();
    const url = new URL(req.url);
    const path = url.pathname;

    const disable = /\/endpoints\/([^/]+)\/disable$/.exec(path);
    if (disable && method === "POST") {
      const id = disable[1] as string;
      await endpointForTenant(id, tenantId);
      await out.endpoints.disable(id);
      return json(200, { id, state: "disabled" });
    }

    const rotate = /\/endpoints\/([^/]+)\/rotate-secret$/.exec(path);
    if (rotate && method === "POST") {
      const id = rotate[1] as string;
      await endpointForTenant(id, tenantId);
      const body = await readJson(req);
      const keepPreviousFor = (body.keepPreviousFor as string | number | undefined) ?? "24h";
      await out.endpoints.rotateSecret(id, { keepPreviousFor });
      return json(200, { id, rotated: true });
    }

    const byId = /\/endpoints\/([^/]+)$/.exec(path);
    if (byId) {
      const id = byId[1] as string;
      if (method === "GET") return json(200, await endpointForTenant(id, tenantId));
      if (method === "PATCH") {
        await endpointForTenant(id, tenantId);
        const body = await readJson(req);
        return json(200, await out.endpoints.update(id, endpointFields(body, tenantId)));
      }
      if (method === "DELETE") {
        await endpointForTenant(id, tenantId);
        const purgeAttempts = url.searchParams.get("purgeAttempts") === "true";
        await out.endpoints.delete(id, { purgeAttempts });
        return new Response(null, { status: 204 });
      }
    }

    if (/\/endpoints$/.test(path)) {
      if (method === "GET") {
        const endpoints = await out.endpoints.list(tenantId !== undefined ? { tenantId } : {});
        return json(200, { endpoints });
      }
      if (method === "POST") {
        const body = await readJson(req);
        const fields = endpointFields(body, tenantId);
        if (fields.url === undefined) {
          return json(422, { errorCode: "ENDPOINT_VALIDATION", error: "url is required" });
        }
        return json(201, await out.endpoints.create(fields as EndpointCreateOptions));
      }
    }

    const messageAttempts = /\/messages\/([^/]+)\/attempts$/.exec(path);
    if (messageAttempts && method === "GET") {
      const id = messageAttempts[1] as string;
      const msg = await messageForTenant(id, tenantId);
      if (!msg) {
        return json(404, { errorCode: "MESSAGE_NOT_FOUND", error: `message not found: ${id}` });
      }
      return json(200, { attempts: await out.messages.attempts(id) });
    }

    const messageById = /\/messages\/([^/]+)$/.exec(path);
    if (messageById && method === "GET") {
      const id = messageById[1] as string;
      const msg = await messageForTenant(id, tenantId);
      if (!msg) {
        return json(404, { errorCode: "MESSAGE_NOT_FOUND", error: `message not found: ${id}` });
      }
      return json(200, msg);
    }

    if (/\/messages$/.test(path) && method === "GET") {
      const listOpts: { -readonly [K in keyof MessageListOptions]?: MessageListOptions[K] } = {};
      const types = csvParam(url, "type");
      if (types.length > 0) listOpts.types = types;
      const statuses = csvParam(url, "status") as MessageStatus[];
      if (statuses.length > 0) listOpts.status = statuses;
      const since = url.searchParams.get("since");
      if (since) listOpts.since = since;
      const until = url.searchParams.get("until");
      if (until) listOpts.until = until;
      const limit = url.searchParams.get("limit");
      if (limit !== null && Number.isFinite(Number(limit))) listOpts.limit = Number(limit);
      // Tenant scoping is authorize-derived; a bound caller can't widen it via query.
      if (tenantId !== undefined) listOpts.tenantId = tenantId;
      else {
        const qt = url.searchParams.get("tenantId");
        if (qt) listOpts.tenantId = qt;
      }
      return json(200, { messages: await out.messages.list(listOpts) });
    }

    if (/\/replay$/.test(path) && method === "POST") {
      const body = await readJson(req);
      return json(200, await out.replay(replayOptionsFromBody(body)));
    }

    if (/\/reconcile$/.test(path) && method === "POST") {
      const body = await readJson(req);
      if (typeof body.endpointId !== "string" || body.since === undefined) {
        return json(422, {
          errorCode: "ENDPOINT_VALIDATION",
          error: "reconcile requires { endpointId, since }",
        });
      }
      const messageIds = await out.reconcile({
        endpointId: body.endpointId,
        since: String(body.since),
      });
      return json(200, { messageIds });
    }

    const rateLimit = /\/tenants\/([^/]+)\/rate-limit$/.exec(path);
    if (rateLimit && method === "POST") {
      const id = rateLimit[1] as string;
      if (tenantId !== undefined && id !== tenantId) {
        return json(403, { errorCode: "FORBIDDEN", error: "cross-tenant access denied" });
      }
      const body = await readJson(req);
      const perSecond = Number(body.perSecond);
      await out.tenants.setRateLimit(id, { perSecond });
      return json(200, { tenantId: id, rateLimit: { perSecond } });
    }

    const tenantById = /\/tenants\/([^/]+)$/.exec(path);
    if (tenantById && method === "DELETE") {
      const id = tenantById[1] as string;
      if (tenantId !== undefined && id !== tenantId) {
        return json(403, { errorCode: "FORBIDDEN", error: "cross-tenant access denied" });
      }
      await out.tenants.delete(id);
      return new Response(null, { status: 204 });
    }

    if (/\/keys\/symmetric$/.test(path) && method === "POST") {
      return json(201, { secret: out.keys.generateSymmetric() });
    }
    if (/\/keys\/asymmetric$/.test(path) && method === "POST") {
      return json(201, await out.keys.generateAsymmetric());
    }

    return json(404, { errorCode: "NOT_FOUND", error: `no admin route for ${method} ${path}` });
  }

  return async (req: Request): Promise<Response> => {
    if (!opts.authorize) {
      if (!warnedNoAuthorize) {
        warnedNoAuthorize = true;
        console.warn(
          "@postel/admin: no `authorize` configured — all admin requests are denied. Pass { authorize }, or { authorize: () => true } only if transport auth runs in front.",
        );
      }
      return json(403, { errorCode: "FORBIDDEN", error: "admin router has no authorize hook" });
    }

    let decision: boolean | AuthDecision;
    try {
      decision = await opts.authorize(req);
    } catch {
      return json(403, { errorCode: "FORBIDDEN", error: "authorization failed" });
    }
    const allow = typeof decision === "boolean" ? decision : decision.allow;
    if (!allow) {
      const status = typeof decision === "object" && decision.status ? decision.status : 403;
      return json(status, {
        errorCode: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
        error: "not authorized",
      });
    }
    let tenantId = typeof decision === "object" ? decision.tenantId : undefined;
    if (tenantId === undefined && opts.resolveTenant) tenantId = opts.resolveTenant(req);

    try {
      return await dispatch(req, tenantId);
    } catch (err) {
      if (err instanceof PostelError) {
        return json(STATUS_BY_CODE[err.code], { errorCode: err.code, error: err.message });
      }
      if ((err as { code?: unknown }).code === "NOT_IMPLEMENTED") {
        return json(501, { errorCode: "NOT_IMPLEMENTED", error: (err as Error).message });
      }
      return json(500, { error: (err as Error).message });
    }
  };
}
