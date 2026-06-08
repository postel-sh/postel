import { type AdminRouterOptions, adminRouter } from "@postel/admin";
import type {
  ComposedVerifyResult,
  EventOf,
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
  type WebhookMethod,
  handleInbound,
  jwksFetchHandler,
} from "@postel/http";
import type { Context, Hono, MiddlewareHandler } from "hono";

export const POSTEL_CONTEXT_KEY = "postel" as const;

const WELL_KNOWN_JWKS = "/.well-known/webhooks-keys";

// A Hono context whose `postel` variable is the verified result, typed to the
// source's event payload. The gate sets it before the handler runs, so reads
// via `c.var.postel` / `c.get("postel")` are non-optional inside a gated route.
type VerifiedContext<TData> = Context<{ Variables: { postel: ComposedVerifyResult<TData> } }>;

type HonoHandler = (c: Context) => Response | Promise<Response>;
type VerifiedHandler<TData> = (c: VerifiedContext<TData>) => Response | Promise<Response>;

function setVerified(c: Context, result: ComposedVerifyResult<unknown>): void {
  (c as VerifiedContext<unknown>).set(POSTEL_CONTEXT_KEY, result);
}

/**
 * Read the verified webhook result off a Hono context on the **primitive**
 * (`verifyWebhook` / `withWebhook`) path, where the handler context isn't
 * statically typed. Throws if the gate did not run. Pass `TData` to type the
 * payload. Routes registered through `HonoWebAdapter(...).inbound.<source>.post`
 * are already typed via `c.var.postel` and don't need this.
 */
export function getVerified<TData = unknown>(c: Context): ComposedVerifyResult<TData> {
  const result = (c as VerifiedContext<TData>).get(POSTEL_CONTEXT_KEY) as
    | ComposedVerifyResult<TData>
    | undefined;
  if (result === undefined) {
    throw new Error(
      "getVerified(): no verified webhook on the context — run verifyWebhook/withWebhook on this route first.",
    );
  }
  return result;
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
  source: GateSource<TData>,
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
    setVerified(c, outcome.context.result);
    await next();
  };
}

export function withWebhook<TData = unknown>(
  source: GateSource<TData>,
  handler: HonoHandler,
  opts?: WebhookHandlerOptions<TData>,
): HonoHandler {
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
    setVerified(c, outcome.context.result);
    return handler(c);
  };
}

type InboundSourcesOf<C extends PostelConfig> = C extends {
  readonly inbound: infer I extends Record<string, InboundSource>;
}
  ? I
  : never;

export interface HonoInboundRoute<TDefault = unknown> {
  /** Gate a route on an explicit body-bearing method (`POST` | `PUT` | `PATCH`). */
  on<TData = TDefault>(
    method: WebhookMethod,
    route: string,
    handler: VerifiedHandler<TData>,
    opts?: WebhookHandlerOptions<TData>,
  ): HonoInboundRoute<TDefault>;
  /** Gate a `POST` route — sugar for `on("POST", …)`. */
  post<TData = TDefault>(
    route: string,
    handler: VerifiedHandler<TData>,
    opts?: WebhookHandlerOptions<TData>,
  ): HonoInboundRoute<TDefault>;
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
  ? {
      readonly inbound: {
        readonly [K in keyof InboundSourcesOf<C>]: HonoInboundRoute<
          EventOf<InboundSourcesOf<C>[K]>
        >;
      };
    }
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
        on(method, route, handler, opts) {
          app.on(
            method,
            route,
            withWebhook(source, handler as HonoHandler, opts as WebhookHandlerOptions | undefined),
          );
          return builder;
        },
        post(route, handler, opts) {
          return builder.on("POST", route, handler, opts);
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
