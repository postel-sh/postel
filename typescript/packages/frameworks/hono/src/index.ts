import { type AdminRouterOptions, adminRouter } from "@postel/admin";
import type {
  ComposedVerifyResult,
  InboundSource,
  OutboundApi,
  PostelConfig,
  PostelInstance,
  WebhookHeaders,
} from "@postel/core";
import {
  type GateSource,
  type JwksProvider,
  type WebhookHandlerOptions,
  handleInbound,
  jwksFetchHandler,
} from "@postel/http";
import type { Context, Hono, MiddlewareHandler } from "hono";

export const POSTEL_CONTEXT_KEY = "postel" as const;

const WELL_KNOWN_JWKS = "/.well-known/webhooks-keys";

declare module "hono" {
  interface ContextVariableMap {
    postel: ComposedVerifyResult<unknown>;
  }
}

function headersFromHono(c: Context): WebhookHeaders {
  const raw = c.req.header();
  const out: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function outcomeResponse(status: number, headers: Record<string, string>, body?: string): Response {
  return new Response(body ?? null, { status, headers });
}

export function verifyWebhook<TData = unknown>(
  source: GateSource,
  opts?: WebhookHandlerOptions<TData>,
): MiddlewareHandler {
  return async (c, next) => {
    const rawBody = new Uint8Array(await c.req.arrayBuffer());
    const outcome = await handleInbound<TData>(
      source,
      { rawBody, headers: headersFromHono(c), method: c.req.method },
      opts,
    );
    if (outcome.kind === "error")
      return outcomeResponse(outcome.status, outcome.headers, outcome.body);
    if (outcome.kind === "duplicate") return outcomeResponse(outcome.status, outcome.headers);
    c.set(POSTEL_CONTEXT_KEY, outcome.context.result as ComposedVerifyResult<unknown>);
    await next();
  };
}

export function withWebhook<TData = unknown>(
  source: GateSource,
  handler: (c: Context) => Response | Promise<Response>,
  opts?: WebhookHandlerOptions<TData>,
): (c: Context) => Promise<Response> {
  return async (c) => {
    const rawBody = new Uint8Array(await c.req.arrayBuffer());
    const outcome = await handleInbound<TData>(
      source,
      { rawBody, headers: headersFromHono(c), method: c.req.method },
      opts,
    );
    if (outcome.kind === "error")
      return outcomeResponse(outcome.status, outcome.headers, outcome.body);
    if (outcome.kind === "duplicate") return outcomeResponse(outcome.status, outcome.headers);
    c.set(POSTEL_CONTEXT_KEY, outcome.context.result as ComposedVerifyResult<unknown>);
    return handler(c);
  };
}

type InboundSourcesOf<C extends PostelConfig> = C extends {
  readonly inbound: infer I extends Record<string, InboundSource>;
}
  ? I
  : never;

type HonoHandler = (c: Context) => Response | Promise<Response>;

export interface HonoInboundRoute {
  post<TData = unknown>(
    route: string,
    handler: HonoHandler,
    opts?: WebhookHandlerOptions<TData>,
  ): HonoInboundRoute;
}

export interface HonoOutboundBindings {
  bindJwks(route?: string, provider?: JwksProvider): void;
}

export interface HonoAdminBindings {
  bindAdminRoutes(prefix: string, opts: AdminRouterOptions): void;
}

type HonoWebAdapter<C extends PostelConfig> = (C extends {
  readonly inbound: Record<string, InboundSource>;
}
  ? { readonly inbound: { readonly [K in keyof InboundSourcesOf<C>]: HonoInboundRoute } }
  : object) &
  (C extends { readonly outbound: object }
    ? { readonly outbound: HonoOutboundBindings; readonly admin: HonoAdminBindings }
    : object);

export function HonoWebAdapter<const C extends PostelConfig>(
  postel: PostelInstance<C>,
  app: Hono,
): HonoWebAdapter<C> {
  const p = postel as unknown as {
    readonly inbound?: Record<string, GateSource>;
    readonly outbound?: OutboundApi;
  };
  const result: {
    inbound?: Record<string, HonoInboundRoute>;
    outbound?: HonoOutboundBindings;
    admin?: HonoAdminBindings;
  } = {};

  if (p.inbound) {
    const inbound: Record<string, HonoInboundRoute> = {};
    for (const key of Object.keys(p.inbound)) {
      const source = p.inbound[key] as GateSource;
      const builder: HonoInboundRoute = {
        post(route, handler, opts) {
          app.post(route, withWebhook(source, handler, opts));
          return builder;
        },
      };
      inbound[key] = builder;
    }
    result.inbound = inbound;
  }

  if (p.outbound) {
    const outbound = p.outbound;
    result.outbound = {
      bindJwks(route = WELL_KNOWN_JWKS, provider = () => outbound.keys.publicJwks()) {
        app.get(route, (c) => jwksFetchHandler(provider)(c.req.raw));
      },
    };
    result.admin = {
      bindAdminRoutes(prefix, opts) {
        const router = adminRouter({ outbound }, opts);
        app.all(`${prefix}/*`, (c) => router(c.req.raw));
      },
    };
  }

  return result as HonoWebAdapter<C>;
}
