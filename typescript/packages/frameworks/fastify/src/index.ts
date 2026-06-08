import { type AdminRouterOptions, adminRouter } from "@postel/admin";
import type {
  ComposedVerifyResult,
  InboundSource,
  OutboundApi,
  PostelConfig,
  PostelInstance,
} from "@postel/core";
import {
  type GateSource,
  type JwksProvider,
  type WebhookHandlerOptions,
  handleInbound,
  jwksFetchHandler,
} from "@postel/http";
import { headersFromNode } from "@postel/http/node";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyRequest {
    postel?: ComposedVerifyResult<unknown>;
  }
}

const WELL_KNOWN_JWKS = "/.well-known/webhooks-keys";

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
  source: GateSource,
  opts?: WebhookHandlerOptions<TData>,
): preHandlerHookHandler {
  return async (req, reply) => {
    const outcome = await handleInbound<TData>(
      source,
      { rawBody: rawBuffer(req.body), headers: headersFromNode(req.headers), method: req.method },
      opts,
    );
    if (outcome.kind === "verified") {
      req.postel = outcome.context.result;
      return;
    }
    return sendOutcome(reply, outcome.status, outcome.headers, outcome.body);
  };
}

export function withWebhook<TData = unknown>(
  source: GateSource,
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
    req.postel = outcome.context.result;
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

export interface FastifyInboundRoute {
  post<TData = unknown>(
    route: string,
    handler: FastifyHandler,
    opts?: WebhookHandlerOptions<TData>,
  ): FastifyInboundRoute;
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
  ? { readonly inbound: { readonly [K in keyof InboundSourcesOf<C>]: FastifyInboundRoute } }
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
      const builder: FastifyInboundRoute = {
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
