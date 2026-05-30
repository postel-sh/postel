import { MalformedHeader, SignatureInvalid, TimestampTooOld } from "./errors.js";
import { ttlToSeconds } from "./ttl.js";
import type {
  DedupAdapter,
  DedupResult,
  Secret as RawSecret,
  SecretOrKeyset,
  VerifyOptions,
  VerifyResult,
  WebhookEvent,
  WebhookHeaders,
} from "./types.js";
import { verify } from "./verify.js";

import type { Verifier } from "./strategies/verify.js";

export interface InboundSource {
  readonly verify: Verifier | ReadonlyArray<Verifier>;
  readonly dedup?: DedupAdapter | undefined;
  readonly dedupTtl?: number | string;
  readonly tolerance?: number;
  readonly now?: () => Date;
  readonly onSuccess?: (event: WebhookEvent, result: ComposedVerifyResult) => void;
  readonly onFailure?: (error: Error, headers: WebhookHeaders) => void;
}

export interface ComposedVerifyResult<TData = unknown> extends VerifyResult<TData> {
  readonly matchedVerifierIndex: number;
}

export interface InboundDedupOptions {
  readonly ttl?: number | string;
  readonly tx?: unknown;
}

export type InboundSourceApi<S extends InboundSource> = {
  verify<TData = unknown>(
    rawBody: ArrayBuffer | Uint8Array | string,
    headers: WebhookHeaders,
  ): Promise<ComposedVerifyResult<TData>>;
} & (S extends { readonly dedup: DedupAdapter }
  ? { dedup(messageId: string, options?: InboundDedupOptions): Promise<DedupResult> }
  : object);

export type InboundApi<S extends Record<string, InboundSource>> = {
  [K in keyof S]: InboundSourceApi<S[K]>;
};

function verifierToSecretOrKeyset(v: Verifier): SecretOrKeyset {
  if (v.kind === "secret") return v.value satisfies RawSecret;
  if (v.kind === "public-key") return v.value satisfies RawSecret;
  return v.keyset;
}

async function attempt<TData>(
  v: Verifier,
  rawBody: ArrayBuffer | Uint8Array | string,
  headers: WebhookHeaders,
  options: VerifyOptions,
): Promise<VerifyResult<TData>> {
  const secretOrKeyset = verifierToSecretOrKeyset(v);
  return verify<TData>(rawBody, headers, secretOrKeyset, options);
}

async function verifySource<TData>(
  source: InboundSource,
  rawBody: ArrayBuffer | Uint8Array | string,
  headers: WebhookHeaders,
): Promise<ComposedVerifyResult<TData>> {
  const verifiers = Array.isArray(source.verify) ? source.verify : [source.verify];
  if (verifiers.length === 0) {
    throw new MalformedHeader("inbound source has no verifiers configured");
  }
  const options: VerifyOptions = {
    ...(source.tolerance !== undefined ? { toleranceSeconds: source.tolerance } : {}),
    ...(source.now ? { now: source.now } : {}),
  };

  let lastError: unknown;
  for (let i = 0; i < verifiers.length; i++) {
    const v = verifiers[i] as Verifier;
    try {
      const result = await attempt<TData>(v, rawBody, headers, options);
      const composed: ComposedVerifyResult<TData> = { ...result, matchedVerifierIndex: i };
      source.onSuccess?.(result.event, composed);
      return composed;
    } catch (err) {
      if (err instanceof TimestampTooOld) {
        source.onFailure?.(err, headers);
        throw err;
      }
      lastError = err;
    }
  }

  const cause = lastError instanceof Error ? lastError : undefined;
  const err = new SignatureInvalid(
    `no verifier matched (tried ${verifiers.length})`,
    cause ? { cause } : undefined,
  );
  source.onFailure?.(err, headers);
  throw err;
}

function buildSourceApi<S extends InboundSource>(key: string, source: S): InboundSourceApi<S> {
  const verifyMethod = {
    async verify<TData = unknown>(
      rawBody: ArrayBuffer | Uint8Array | string,
      headers: WebhookHeaders,
    ): Promise<ComposedVerifyResult<TData>> {
      return verifySource<TData>(source, rawBody, headers);
    },
  };
  if (!source.dedup) {
    return verifyMethod as InboundSourceApi<S>;
  }
  const dedupAdapter = source.dedup;
  const defaultTtl = source.dedupTtl;
  return {
    ...verifyMethod,
    async dedup(messageId: string, options?: InboundDedupOptions): Promise<DedupResult> {
      const ttl = options?.ttl ?? defaultTtl;
      if (ttl === undefined) {
        throw new MalformedHeader(
          `inbound source "${key}" dedup() called without ttl; provide one at the call site or via dedupTtl in config`,
        );
      }
      const recordOpts = options?.tx !== undefined ? { tx: options.tx } : undefined;
      return dedupAdapter.record(messageId, ttlToSeconds(ttl), recordOpts);
    },
  } as InboundSourceApi<S>;
}

export function buildInboundApi<S extends Record<string, InboundSource>>(
  sources: S,
): InboundApi<S> {
  const result = {} as { [K in keyof S]: InboundSourceApi<S[K]> };
  for (const key of Object.keys(sources) as Array<keyof S>) {
    result[key] = buildSourceApi(String(key), sources[key]);
  }
  return result;
}
