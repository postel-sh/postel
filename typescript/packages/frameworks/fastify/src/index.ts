import type {
  ComposedVerifyResult,
  InboundApi,
  InboundSource,
  PostelConfig,
  PostelInstance,
} from "@postel/core";
import { type GateSource, type WebhookHandlerOptions, handleInbound } from "@postel/http";
import { headersFromNode } from "@postel/http/node";
import type {
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

type InboundSourcesOf<C extends PostelConfig> = C extends {
  readonly inbound: infer I extends Record<string, InboundSource>;
}
  ? I
  : never;

export function fastifyAdapter<const C extends PostelConfig>(
  postel: PostelInstance<C> & { readonly inbound: InboundApi<InboundSourcesOf<C>> },
): {
  verify<K extends keyof InboundSourcesOf<C>, TData = unknown>(
    key: K,
    opts?: WebhookHandlerOptions<TData>,
  ): preHandlerHookHandler;
  guard<K extends keyof InboundSourcesOf<C>, TData = unknown>(
    key: K,
    handler: (req: FastifyRequest, reply: FastifyReply) => unknown | Promise<unknown>,
    opts?: WebhookHandlerOptions<TData>,
  ): (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
} {
  return {
    verify(key, opts) {
      return verifyWebhook(postel.inbound[key], opts);
    },
    guard(key, handler, opts) {
      return withWebhook(postel.inbound[key], handler, opts);
    },
  };
}
