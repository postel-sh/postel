import { EventValidation, MalformedHeader, SignatureInvalid, TimestampTooOld } from "./errors.js";
import type { StandardSchemaV1 } from "./standard-schema.js";
import type { Verifier } from "./strategies/verify.js";
import { ttlToSeconds } from "./ttl.js";
import type {
  DedupAdapter,
  DedupResult,
  VerifyOptions,
  VerifyResult,
  WebhookEvent,
  WebhookHeaders,
} from "./types.js";

export interface InboundSource<TData = unknown> {
  readonly verify: Verifier | ReadonlyArray<Verifier>;
  /**
   * Optional Standard Schema (zod, valibot, …) describing the event `data`
   * payload. When present, `verify()` validates `event.data` against it after
   * the signature check, throws `EventValidation` on mismatch, and narrows the
   * verified result's `TData` to the schema's output type.
   */
  readonly schema?: StandardSchemaV1<unknown, TData>;
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

// The event-data type a source produces: the schema's output when a `schema`
// is configured, otherwise `unknown`. Drives the default `TData` of `verify()`
// and lets framework adapters type their handlers off the configured source.
export type EventOf<S> = S extends { readonly schema?: StandardSchemaV1<unknown, infer T> }
  ? T
  : unknown;

export type InboundSourceApi<S extends InboundSource> = {
  verify<TData = EventOf<S>>(
    rawBody: ArrayBuffer | Uint8Array | string,
    headers: WebhookHeaders,
  ): Promise<ComposedVerifyResult<TData>>;
} & (S extends { readonly dedup: DedupAdapter }
  ? { dedup(messageId: string, options?: InboundDedupOptions): Promise<DedupResult> }
  : object);

export type InboundApi<S extends Record<string, InboundSource>> = {
  [K in keyof S]: InboundSourceApi<S[K]>;
};

async function attempt<TData>(
  v: Verifier,
  rawBody: ArrayBuffer | Uint8Array | string,
  headers: WebhookHeaders,
  options: VerifyOptions,
): Promise<VerifyResult<TData>> {
  return (await v.verify(rawBody, headers, options)) as VerifyResult<TData>;
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

  let matched: ComposedVerifyResult<TData> | undefined;
  let lastError: unknown;
  for (let i = 0; i < verifiers.length; i++) {
    const v = verifiers[i] as Verifier;
    try {
      const result = await attempt<TData>(v, rawBody, headers, options);
      matched = { ...result, matchedVerifierIndex: i };
      break;
    } catch (err) {
      if (err instanceof TimestampTooOld) {
        source.onFailure?.(err, headers);
        throw err;
      }
      lastError = err;
    }
  }

  if (!matched) {
    const cause = lastError instanceof Error ? lastError : undefined;
    const err = new SignatureInvalid(
      `no verifier matched (tried ${verifiers.length})`,
      cause ? { cause } : undefined,
    );
    source.onFailure?.(err, headers);
    throw err;
  }

  // Schema validation runs only after a verifier matched, so a valid signature
  // carrying a bad payload throws EventValidation rather than being retried
  // against the next verifier or surfaced as SignatureInvalid.
  if (source.schema) {
    const out = await source.schema["~standard"].validate(matched.event.data);
    if (out.issues) {
      const err = new EventValidation(out.issues);
      source.onFailure?.(err, headers);
      throw err;
    }
    const validated: ComposedVerifyResult<TData> = {
      ...matched,
      event: { ...matched.event, data: out.value as TData },
    };
    source.onSuccess?.(validated.event, validated);
    return validated;
  }

  source.onSuccess?.(matched.event, matched);
  return matched;
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
