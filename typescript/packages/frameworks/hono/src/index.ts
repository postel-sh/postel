import {
  type SecretOrKeyset,
  type VerifyOptions,
  type VerifyResult,
  type WebhookHeaders,
  verify,
} from "@postel/core";
import type { Context, MiddlewareHandler } from "hono";

export type HonoVerifyOptions = VerifyOptions;

export const POSTEL_CONTEXT_KEY = "postel" as const;

declare module "hono" {
  interface ContextVariableMap {
    postel: VerifyResult<unknown>;
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

export async function honoVerify<TData = unknown>(
  c: Context,
  secretOrKeyset: SecretOrKeyset,
  options?: HonoVerifyOptions,
): Promise<VerifyResult<TData>> {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const headers = headersFromHono(c);
  return verify<TData>(bytes, headers, secretOrKeyset, options);
}

export function postelHono<TData = unknown>(
  secretOrKeyset: SecretOrKeyset,
  options?: HonoVerifyOptions,
): MiddlewareHandler {
  return async (c, next) => {
    const result = await honoVerify<TData>(c, secretOrKeyset, options);
    c.set(POSTEL_CONTEXT_KEY, result as VerifyResult<unknown>);
    await next();
  };
}
