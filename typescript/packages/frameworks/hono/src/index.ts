import {
  type ComposedVerifyResult,
  type InboundApi,
  type InboundSource,
  type PostelConfig,
  type PostelInstance,
  type SecretOrKeyset,
  type VerifyOptions,
  type VerifyResult,
  type WebhookHeaders,
  verify,
} from "@postel/core";
import {
  type GateSource,
  type JwksProvider,
  type WebhookHandlerOptions,
  handleInbound,
  jwksFetchHandler,
} from "@postel/http";
import type { Context, MiddlewareHandler } from "hono";

export type HonoVerifyOptions = VerifyOptions;

export const POSTEL_CONTEXT_KEY = "postel" as const;

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

export function honoAdapter<const C extends PostelConfig>(
  postel: PostelInstance<C> & { readonly inbound: InboundApi<InboundSourcesOf<C>> },
): {
  verify<K extends keyof InboundSourcesOf<C>, TData = unknown>(
    key: K,
    opts?: WebhookHandlerOptions<TData>,
  ): MiddlewareHandler;
  guard<K extends keyof InboundSourcesOf<C>, TData = unknown>(
    key: K,
    handler: (c: Context) => Response | Promise<Response>,
    opts?: WebhookHandlerOptions<TData>,
  ): (c: Context) => Promise<Response>;
  jwks(provider: JwksProvider): (c: Context) => Promise<Response>;
} {
  return {
    verify(key, opts) {
      return verifyWebhook(postel.inbound[key], opts);
    },
    guard(key, handler, opts) {
      return withWebhook(postel.inbound[key], handler, opts);
    },
    jwks(provider) {
      return (c) => jwksFetchHandler(provider)(c.req.raw);
    },
  };
}

/**
 * @deprecated Use `verifyWebhook(postel.inbound.<source>)` or `honoAdapter(postel).verify(...)`.
 * Threads a raw secret instead of the configured inbound source.
 */
export async function honoVerify<TData = unknown>(
  c: Context,
  secretOrKeyset: SecretOrKeyset,
  options?: HonoVerifyOptions,
): Promise<VerifyResult<TData>> {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const headers = headersFromHono(c);
  return verify<TData>(bytes, headers, secretOrKeyset, options);
}

/**
 * @deprecated Use `verifyWebhook(postel.inbound.<source>)` or `honoAdapter(postel).verify(...)`,
 * which bind the configured source and map protocol errors to HTTP status automatically.
 */
export function postelHono<TData = unknown>(
  secretOrKeyset: SecretOrKeyset,
  options?: HonoVerifyOptions,
): MiddlewareHandler {
  return async (c, next) => {
    const result = await honoVerify<TData>(c, secretOrKeyset, options);
    c.set(POSTEL_CONTEXT_KEY, {
      ...result,
      matchedVerifierIndex: result.matchedSecretIndex,
    } as ComposedVerifyResult<unknown>);
    await next();
  };
}
