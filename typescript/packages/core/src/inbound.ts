import {
  MalformedHeader,
  SignatureInvalid,
  TimestampTooOld,
  UnknownKeyId,
  verify as edgeVerify,
} from "@postel/edge";
import type {
  DedupAdapter,
  DedupResult,
  Secret as EdgeSecret,
  SecretOrKeyset,
  VerifyOptions,
  VerifyResult,
  WebhookEvent,
  WebhookHeaders,
} from "@postel/edge";

import type { Verifier } from "./strategies/verify.js";

export interface InboundSource {
  readonly verify: Verifier | ReadonlyArray<Verifier>;
  readonly dedup?: DedupAdapter;
  readonly dedupKey?: (event: WebhookEvent) => string;
  readonly dedupTtl?: number | string;
  readonly tolerance?: number;
  readonly now?: () => Date;
  readonly tenantId?: string | ((headers: WebhookHeaders) => string);
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
} & ("dedup" extends keyof S
  ? { dedup(messageId: string, options?: InboundDedupOptions): Promise<DedupResult> }
  : object);

export type InboundApi<S extends Record<string, InboundSource>> = {
  [K in keyof S]: InboundSourceApi<S[K]>;
};

function verifierToSecretOrKeyset(v: Verifier): SecretOrKeyset {
  if (v.kind === "secret") return v.value satisfies EdgeSecret;
  if (v.kind === "public-key") return v.value satisfies EdgeSecret;
  return v.keyset;
}

async function attempt<TData>(
  v: Verifier,
  rawBody: ArrayBuffer | Uint8Array | string,
  headers: WebhookHeaders,
  options: VerifyOptions,
): Promise<VerifyResult<TData>> {
  const secretOrKeyset = verifierToSecretOrKeyset(v);
  return edgeVerify<TData>(rawBody, headers, secretOrKeyset, options);
}

function isRetryableAcrossVerifiers(err: unknown): boolean {
  return err instanceof SignatureInvalid || err instanceof UnknownKeyId;
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

  let lastNonRetryable: unknown;
  for (let i = 0; i < verifiers.length; i++) {
    const v = verifiers[i] as Verifier;
    try {
      const result = await attempt<TData>(v, rawBody, headers, options);
      const composed: ComposedVerifyResult<TData> = { ...result, matchedVerifierIndex: i };
      source.onSuccess?.(result.event, composed);
      return composed;
    } catch (err) {
      if (err instanceof MalformedHeader || err instanceof TimestampTooOld) {
        lastNonRetryable = err;
        break;
      }
      if (!isRetryableAcrossVerifiers(err)) {
        lastNonRetryable = err;
        break;
      }
    }
  }

  const err =
    lastNonRetryable instanceof Error
      ? lastNonRetryable
      : new SignatureInvalid(`no verifier matched (tried ${verifiers.length})`);
  source.onFailure?.(err, headers);
  throw err;
}

function ttlToSecondsApprox(ttl: number | string): number {
  if (typeof ttl === "number") return ttl;
  return parseDurationToSeconds(ttl);
}

function parseDurationToSeconds(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i);
  if (!match) throw new Error(`unrecognized duration: ${value}`);
  const n = Number(match[1]);
  const unit = (match[2] as string).toLowerCase();
  switch (unit) {
    case "ms":
      return n / 1000;
    case "s":
      return n;
    case "m":
      return n * 60;
    case "h":
      return n * 60 * 60;
    case "d":
      return n * 60 * 60 * 24;
    default:
      throw new Error(`unrecognized duration unit: ${unit}`);
  }
}

function buildSourceApi(key: string, source: InboundSource): Record<string, unknown> {
  const verifyMethod = {
    async verify(rawBody: ArrayBuffer | Uint8Array | string, headers: WebhookHeaders) {
      return verifySource(source, rawBody, headers);
    },
  };
  if (!source.dedup) {
    return verifyMethod;
  }
  const dedupAdapter = source.dedup;
  const defaultTtl = source.dedupTtl;
  return {
    ...verifyMethod,
    async dedup(messageId: string, options?: InboundDedupOptions) {
      const ttl = options?.ttl ?? defaultTtl;
      if (ttl === undefined) {
        throw new Error(
          `inbound source "${key}" dedup() called without ttl; provide one at the call site or via dedupTtl in config`,
        );
      }
      return dedupAdapter.record(messageId, ttlToSecondsApprox(ttl));
    },
  };
}

export function buildInboundApi<S extends Record<string, InboundSource>>(
  sources: S,
): InboundApi<S> {
  const entries = Object.entries(sources).map(
    ([key, source]) => [key, buildSourceApi(key, source)] as const,
  );
  return Object.fromEntries(entries) as InboundApi<S>;
}
