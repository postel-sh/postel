import { type AdminRouterOptions, adminRouter } from "@postel/admin";
import type {
  ComposedVerifyResult,
  EventOf,
  InboundSource,
  OutboundApi,
  PostelConfig,
  PostelInstance,
} from "@postel/core";
import {
  type GateSource,
  type JwksProvider,
  type WebhookHandlerOptions,
  type WebhookMethod,
  handleInbound,
  jwksFetchHandler,
} from "@postel/http";
import { headersFromNode } from "@postel/http/node";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  RouteShorthandOptions,
  preHandlerHookHandler,
} from "fastify";
import fp from "fastify-plugin";

const WELL_KNOWN_JWKS = "/.well-known/webhooks-keys";

// The gate sets the verified result on `req.postel`; a handler registered
// through the facade sees it as a non-optional, source-typed field.
type VerifiedRequest<TData> = FastifyRequest & { readonly postel: ComposedVerifyResult<TData> };
type FastifyVerifiedHandler<TData> = (
  req: VerifiedRequest<TData>,
  reply: FastifyReply,
) => unknown | Promise<unknown>;

function setVerified(req: FastifyRequest, result: ComposedVerifyResult<unknown>): void {
  (req as { postel?: ComposedVerifyResult<unknown> }).postel = result;
}

/**
 * Read the verified webhook result off a Fastify request on the **primitive**
 * (`verifyWebhook` preHandler) path. Throws if the gate did not run. Pass
 * `TData` to type the payload. Routes registered through
 * `FastifyWebAdapter(...).inbound.<source>.post` receive a typed `req.postel`.
 */
export function getVerified<TData = unknown>(req: FastifyRequest): ComposedVerifyResult<TData> {
  const result = (req as { postel?: ComposedVerifyResult<TData> }).postel;
  if (result === undefined) {
    throw new Error(
      "getVerified(): no verified webhook on the request — run verifyWebhook on this route first.",
    );
  }
  return result;
}

export const fastifyPostel: FastifyPluginAsync = fp(
  async (fastify) => {
    // Webhook verification needs the exact received bytes. Drop the built-in
    // application/json parser (which would re-parse the body) and capture every
    // content type as a raw Buffer. Register on a fastify instance or scope
    // dedicated to webhook routes.
    fastify.removeAllContentTypeParsers();
    fastify.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => {
      done(null, body);
    });
  },
  { name: "@postel/fastify", fastify: ">=4" },
);

function rawBuffer(body: unknown): Uint8Array {
  return body instanceof Uint8Array ? body : new Uint8Array(0);
}

function sendOutcome(
  reply: FastifyReply,
  status: number,
  headers: Record<string, string>,
  body?: string,
) {
  reply.code(status);
  for (const [name, value] of Object.entries(headers)) reply.header(name, value);
  return reply.send(body ?? null);
}

export function verifyWebhook<TData = unknown>(
  source: GateSource<TData>,
  opts?: WebhookHandlerOptions<TData>,
): preHandlerHookHandler {
  return async (req, reply) => {
    const outcome = await handleInbound<TData>(
      source,
      { rawBody: rawBuffer(req.body), headers: headersFromNode(req.headers), method: req.method },
      opts,
    );
    if (outcome.kind === "verified") {
      setVerified(req, outcome.context.result);
      return;
    }
    return sendOutcome(reply, outcome.status, outcome.headers, outcome.body);
  };
}

export function withWebhook<TData = unknown>(
  source: GateSource<TData>,
  handler: (req: FastifyRequest, reply: FastifyReply) => unknown | Promise<unknown>,
  opts?: WebhookHandlerOptions<TData>,
): (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  return async (req, reply) => {
    const outcome = await handleInbound<TData>(
      source,
      { rawBody: rawBuffer(req.body), headers: headersFromNode(req.headers), method: req.method },
      opts,
    );
    if (outcome.kind !== "verified") {
      return sendOutcome(reply, outcome.status, outcome.headers, outcome.body);
    }
    setVerified(req, outcome.context.result);
    return handler(req, reply);
  };
}

export function fetchToFastify(handler: (req: Request) => Promise<Response>) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const init: RequestInit = { method: req.method, headers: headersFromNode(req.headers) };
    if (req.body !== undefined && req.body !== null) {
      init.body = Buffer.isBuffer(req.body)
        ? req.body
        : typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body);
    }
    const response = await handler(new Request(`http://local${req.url}`, init));
    reply.code(response.status);
    response.headers.forEach((value, name) => reply.header(name, value));
    return reply.send(await response.text());
  };
}

type InboundSourcesOf<C extends PostelConfig> = C extends {
  readonly inbound: infer I extends Record<string, InboundSource>;
}
  ? I
  : never;

type FastifyHandler = (req: FastifyRequest, reply: FastifyReply) => unknown | Promise<unknown>;

/**
 * Route options for a gated webhook route. This is Fastify's own
 * `RouteShorthandOptions` — so `onRequest`, `preHandler`, `schema`, `bodyLimit`,
 * `config`, … all behave exactly as they do on `fastify.post` — plus one extra
 * key:
 *
 * - `webhook` — Postel's gate options (`dedup`, `successStatus`, `onVerified`).
 *   They are namespaced under this single key rather than passed as a separate
 *   argument, so the object you hand to `.post` stays a plain Fastify route
 *   options object that reads like any other `fastify.post(...)` call. The
 *   adapter reads `webhook`, strips it, and forwards everything else to Fastify
 *   untouched.
 *
 * The verification gate is injected as the FIRST `preHandler`, so Fastify's
 * lifecycle gives you the split for free: `onRequest` runs BEFORE verification
 * (body not parsed yet — good for rate-limit / IP allow-listing) and any
 * `preHandler` you supply runs AFTER it, with the verified result already on
 * `req.postel`.
 */
export type FastifyWebhookRouteOptions = RouteShorthandOptions & {
  webhook?: WebhookHandlerOptions;
};

export interface FastifyInboundRoute<TDefault = unknown> {
  /** Gate a route on an explicit body-bearing method. Pass gate options as the fourth argument. */
  on<TData = TDefault>(
    method: WebhookMethod,
    route: string,
    handler: FastifyVerifiedHandler<TData>,
    webhook?: WebhookHandlerOptions<TData>,
  ): FastifyInboundRoute<TDefault>;
  /** Gate a route on an explicit method, passing Fastify route options (gate options under `webhook`). */
  on<TData = TDefault>(
    method: WebhookMethod,
    route: string,
    options: FastifyWebhookRouteOptions,
    handler: FastifyVerifiedHandler<TData>,
  ): FastifyInboundRoute<TDefault>;
  /** Gate a `POST` route — sugar for `on("POST", …)`. Pass gate options (`dedup`, …) as the third argument. */
  post<TData = TDefault>(
    route: string,
    handler: FastifyVerifiedHandler<TData>,
    webhook?: WebhookHandlerOptions<TData>,
  ): FastifyInboundRoute<TDefault>;
  /**
   * Gate a `POST` route while passing Fastify route options (`onRequest`, `preHandler`,
   * `schema`, …). Postel gate options go under the `webhook` key. The gate is
   * injected as the first `preHandler`.
   */
  post<TData = TDefault>(
    route: string,
    options: FastifyWebhookRouteOptions,
    handler: FastifyVerifiedHandler<TData>,
  ): FastifyInboundRoute<TDefault>;
}

export interface FastifyOutboundBindings {
  bindJwks(route?: string, provider?: JwksProvider): void;
}

export interface FastifyAdminBindings {
  bindAdminRoutes(prefix: string, opts: AdminRouterOptions): void;
}

type FastifyWebAdapter<C extends PostelConfig> = (C extends {
  readonly inbound: Record<string, InboundSource>;
}
  ? {
      readonly inbound: {
        readonly [K in keyof InboundSourcesOf<C>]: FastifyInboundRoute<
          EventOf<InboundSourcesOf<C>[K]>
        >;
      };
    }
  : object) &
  (C extends { readonly outbound: object }
    ? { readonly outbound: FastifyOutboundBindings; readonly admin: FastifyAdminBindings }
    : object);

export function FastifyWebAdapter<const C extends PostelConfig>(
  postel: PostelInstance<C>,
  app: FastifyInstance,
): FastifyWebAdapter<C> {
  const p = postel as unknown as {
    readonly inbound?: Record<string, GateSource>;
    readonly outbound?: OutboundApi;
  };
  const result: {
    inbound?: Record<string, FastifyInboundRoute>;
    outbound?: FastifyOutboundBindings;
    admin?: FastifyAdminBindings;
  } = {};

  if (p.inbound) {
    const inbound: Record<string, FastifyInboundRoute> = {};
    for (const key of Object.keys(p.inbound)) {
      const source = p.inbound[key] as GateSource;
      const register = (
        method: WebhookMethod,
        route: string,
        optionsOrHandler: FastifyHandler | FastifyWebhookRouteOptions,
        maybeHandler?: FastifyHandler | WebhookHandlerOptions,
      ): void => {
        if (typeof optionsOrHandler === "function") {
          // (route, handler, webhook?)
          const webhook = maybeHandler as WebhookHandlerOptions | undefined;
          app.route({
            method,
            url: route,
            preHandler: verifyWebhook(source, webhook),
            handler: optionsOrHandler,
          });
          return;
        }
        // (route, options, handler) — inject the gate as the first preHandler,
        // strip the Postel-only `webhook` key, forward the rest to Fastify.
        const { webhook, preHandler, ...routeOpts } = optionsOrHandler;
        const userPreHandlers: preHandlerHookHandler[] =
          preHandler === undefined
            ? []
            : Array.isArray(preHandler)
              ? (preHandler as preHandlerHookHandler[])
              : [preHandler as preHandlerHookHandler];
        app.route({
          ...routeOpts,
          method,
          url: route,
          preHandler: [verifyWebhook(source, webhook), ...userPreHandlers],
          handler: maybeHandler as FastifyHandler,
        });
      };
      const builder = {
        on(
          method: WebhookMethod,
          route: string,
          optionsOrHandler: FastifyHandler | FastifyWebhookRouteOptions,
          maybeHandler?: FastifyHandler | WebhookHandlerOptions,
        ): FastifyInboundRoute {
          register(method, route, optionsOrHandler, maybeHandler);
          return builder;
        },
        post(
          route: string,
          optionsOrHandler: FastifyHandler | FastifyWebhookRouteOptions,
          maybeHandler?: FastifyHandler | WebhookHandlerOptions,
        ): FastifyInboundRoute {
          register("POST", route, optionsOrHandler, maybeHandler);
          return builder;
        },
      } as FastifyInboundRoute;
      inbound[key] = builder;
    }
    result.inbound = inbound;
  }

  if (p.outbound) {
    const outbound = p.outbound;
    result.outbound = {
      bindJwks(route = WELL_KNOWN_JWKS, provider = () => outbound.keys.publicJwks()) {
        app.get(route, fetchToFastify(jwksFetchHandler(provider)));
      },
    };
    result.admin = {
      bindAdminRoutes(prefix, opts) {
        app.all(`${prefix}/*`, fetchToFastify(adminRouter({ outbound }, opts)));
      },
    };
  }

  return result as FastifyWebAdapter<C>;
}
