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

export type { ComposedVerifyResult } from "@postel/core";
export type { WebhookContext, WebhookHandlerOptions } from "@postel/http";

const ADMIN_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

// A Next.js Route Handler: the exact function shape `export const POST = ...`
// expects. Route Handlers receive a Web `Request` and Next.js routes to them
// by file path, so — unlike Hono/Express — there is no `app` to register on;
// the facade hands back the handler(s) for the route file to export.
type RouteHandler = (req: Request) => Promise<Response>;
type VerifiedHandler<TData> = (
  result: ComposedVerifyResult<TData>,
  req: Request,
) => Response | Promise<Response>;

function headersFromFetch(req: Request): WebhookHeaders {
  return Object.fromEntries(req.headers.entries());
}

function outcomeResponse(status: number, headers: Record<string, string>, body?: string): Response {
  return new Response(body ?? null, { status, headers });
}

/**
 * Gate a Route Handler on the **primitive** path: verify, then invoke
 * `handler` with the verified result. Routes registered through
 * `NextjsWebAdapter(...).inbound.<source>.post` already do this and don't
 * need it — use `withWebhook` to hand-roll a route file without the facade.
 */
export function withWebhook<TData = unknown>(
  source: GateSource<TData>,
  handler: VerifiedHandler<TData>,
  opts?: WebhookHandlerOptions<TData>,
): RouteHandler {
  return async (req) => {
    const rawBody = new Uint8Array(await req.arrayBuffer());
    const outcome = await handleInbound<TData>(
      source,
      { rawBody, headers: headersFromFetch(req), method: req.method },
      opts,
    );
    if (outcome.kind === "error")
      return outcomeResponse(outcome.status, outcome.headers, outcome.body);
    if (outcome.kind === "duplicate") return outcomeResponse(outcome.status, outcome.headers);
    return handler(outcome.context.result, req);
  };
}

type InboundSourcesOf<C extends PostelConfig> = C extends {
  readonly inbound: infer I extends Record<string, InboundSource>;
}
  ? I
  : never;

export interface NextjsInboundRoute<TDefault = unknown> {
  /** Gate a route on an explicit body-bearing method (`POST` | `PUT` | `PATCH`). */
  on<M extends WebhookMethod, TData = TDefault>(
    method: M,
    handler: VerifiedHandler<TData>,
    opts?: WebhookHandlerOptions<TData>,
  ): Record<M, RouteHandler>;
  /** Gate a `POST` route — sugar for `on("POST", …)`. */
  post<TData = TDefault>(
    handler: VerifiedHandler<TData>,
    opts?: WebhookHandlerOptions<TData>,
  ): { POST: RouteHandler };
}

export interface NextjsOutboundBindings {
  bindJwks(provider?: JwksProvider): { GET: RouteHandler };
}

export interface NextjsAdminBindings {
  bindAdminRoutes(opts: AdminRouterOptions): Record<(typeof ADMIN_METHODS)[number], RouteHandler>;
}

type NextjsWebAdapter<C extends PostelConfig> = (C extends {
  readonly inbound: Record<string, InboundSource>;
}
  ? {
      readonly inbound: {
        readonly [K in keyof InboundSourcesOf<C>]: NextjsInboundRoute<
          EventOf<InboundSourcesOf<C>[K]>
        >;
      };
    }
  : object) &
  (C extends { readonly outbound: object }
    ? { readonly outbound: NextjsOutboundBindings; readonly admin: NextjsAdminBindings }
    : object);

export function NextjsWebAdapter<const C extends PostelConfig>(
  postel: PostelInstance<C>,
): NextjsWebAdapter<C> {
  const p = postel as unknown as {
    readonly inbound?: Record<string, GateSource>;
    readonly outbound?: OutboundApi;
  };
  const result: {
    inbound?: Record<string, NextjsInboundRoute>;
    outbound?: NextjsOutboundBindings;
    admin?: NextjsAdminBindings;
  } = {};

  if (p.inbound) {
    const inbound: Record<string, NextjsInboundRoute> = {};
    for (const key of Object.keys(p.inbound)) {
      const source = p.inbound[key] as GateSource;
      inbound[key] = {
        on(method, handler, opts) {
          return {
            [method]: withWebhook(
              source,
              handler as VerifiedHandler<unknown>,
              opts as WebhookHandlerOptions | undefined,
            ),
          } as Record<typeof method, RouteHandler>;
        },
        post(handler, opts) {
          return {
            POST: withWebhook(
              source,
              handler as VerifiedHandler<unknown>,
              opts as WebhookHandlerOptions | undefined,
            ),
          };
        },
      };
    }
    result.inbound = inbound;
  }

  if (p.outbound) {
    const outbound = p.outbound;
    result.outbound = {
      bindJwks(provider = () => outbound.keys.publicJwks()) {
        return { GET: jwksFetchHandler(provider) };
      },
    };
    result.admin = {
      bindAdminRoutes(opts) {
        const handler = adminRouter({ outbound }, opts);
        const bindings = {} as Record<(typeof ADMIN_METHODS)[number], RouteHandler>;
        for (const method of ADMIN_METHODS) bindings[method] = handler;
        return bindings;
      },
    };
  }

  return result as NextjsWebAdapter<C>;
}
