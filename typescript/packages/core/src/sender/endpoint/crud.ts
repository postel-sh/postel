import { EndpointNotFound } from "../../errors.js";
import { bytesToBase64 } from "../../internal/base64.js";
import { assertHttpWired } from "../../internal/config-guards.js";
import type {
  AutoDisableDefaults,
  CircuitBreakerDefaults,
  Endpoint,
  EndpointCreateOptions,
  EndpointUpdateOptions,
  HttpDefaults,
  SerializableHttpDefaults,
  SerializableRetryStrategy,
} from "../../outbound.js";
import type {
  EndpointRecord,
  EndpointState,
  NewEndpoint,
  SecretAlgorithm,
  Storage,
} from "../../storage/types.js";
import type { SigningStrategy } from "../../strategies/signing.js";
import { DEFAULT_SSRF_POLICY, type SsrfPolicy } from "../dispatcher/ssrf.js";
import { mintSecretMaterial, newSecretId } from "../keys/material.js";
import { validateEndpointUrl } from "./url-validation.js";

type SsrfOverride = HttpDefaults["ssrf"];

export interface EndpointDefaults {
  readonly ssrf?: SsrfPolicy;
  readonly signing?: SigningStrategy;
}

function newEndpointId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `ep_${bytesToBase64(bytes).replace(/[+/=]/g, "")}`;
}

// Function-carrying values are code-side JS values, not serializable data —
// the public read shape normalizes them identically across storage adapters
// (the in-memory adapter holds live functions; DB adapters JSON-strip them).

// Only a plain key/value record survives; callable headers read back as null.
function plainRecordHeaders(headers: unknown): Readonly<Record<string, string>> | null {
  if (headers === null || typeof headers !== "object") return null;
  return headers as Readonly<Record<string, string>>;
}

// A `custom` strategy carries a `compute` function and reads back as null;
// data-only strategies (`exponential`, `linear`) round-trip unchanged.
function serializableRetryPolicy(raw: unknown): SerializableRetryStrategy | null {
  if (raw === null || typeof raw !== "object") return null;
  if ((raw as { kind?: unknown }).kind === "custom") return null;
  return raw as SerializableRetryStrategy;
}

// `fetch` is the one function-typed key on HttpDefaults; the read shape is the
// stored overrides minus that key.
function serializableHttp(raw: unknown): SerializableHttpDefaults | null {
  if (raw === null || typeof raw !== "object") return null;
  const { fetch: _fetch, ...rest } = raw as HttpDefaults;
  return rest;
}

function toPublicEndpoint(rec: EndpointRecord): Endpoint {
  const out: {
    -readonly [K in keyof Endpoint]: Endpoint[K];
  } = {
    id: rec.id,
    url: rec.url,
    state: rec.state,
    types: rec.types,
    channels: rec.channels,
    retryPolicy: serializableRetryPolicy(rec.retryPolicy),
    headers: plainRecordHeaders(rec.headers),
    allowHttp: rec.allowHttp,
    maxInflight: rec.maxInflight,
    http: serializableHttp(rec.http),
    circuitBreaker: rec.circuitBreaker as CircuitBreakerDefaults | null,
    autoDisable: rec.autoDisable as AutoDisableDefaults | null,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
  if (rec.tenantId !== null) out.tenantId = rec.tenantId;
  if (rec.metadata !== null) out.metadata = rec.metadata as Record<string, unknown>;
  return out;
}

export function buildEndpointApi(
  storage: Storage,
  defaults: EndpointDefaults = {},
): {
  create(opts: EndpointCreateOptions, runtime?: { tx?: unknown }): Promise<Endpoint>;
  update(id: string, opts: EndpointUpdateOptions, runtime?: { tx?: unknown }): Promise<Endpoint>;
  delete(id: string, opts?: { purgeAttempts?: boolean; tx?: unknown }): Promise<void>;
  list(opts?: { tenantId?: string; tx?: unknown }): Promise<ReadonlyArray<Endpoint>>;
  get(id: string, opts?: { tx?: unknown }): Promise<Endpoint>;
  disable(id: string, opts?: { tx?: unknown }): Promise<void>;
} {
  const ssrfDefault = defaults.ssrf ?? DEFAULT_SSRF_POLICY;
  const resolveSsrfPolicy = (override: SsrfOverride): SsrfPolicy => {
    if (!override) return ssrfDefault;
    return {
      blockPrivateRanges: override.blockPrivateRanges ?? ssrfDefault.blockPrivateRanges,
      allowedRanges: override.allowedRanges ?? ssrfDefault.allowedRanges,
    };
  };
  return {
    async create(opts, runtime) {
      assertHttpWired(opts.http, "endpoint");
      const allowHttp = opts.allowHttp === true;
      const ssrfPolicy = resolveSsrfPolicy(opts.http?.ssrf);
      await validateEndpointUrl({ url: opts.url, allowHttp, ssrfPolicy });
      const newRecord: NewEndpoint = {
        id: newEndpointId(),
        tenantId: opts.tenantId ?? null,
        url: opts.url,
        state: "active",
        types: opts.types ?? null,
        channels: opts.channels ?? null,
        retryPolicy: opts.retryPolicy ?? null,
        headers: opts.headers ?? null,
        signing: opts.signing ?? null,
        metadata: opts.metadata ?? null,
        allowHttp,
        maxInflight: opts.maxInflight ?? null,
        http: opts.http ?? null,
        circuitBreaker: opts.circuitBreaker ?? null,
        autoDisable: opts.autoDisable ?? null,
        filter: opts.filter ?? null,
        transform: opts.transform ?? null,
      };
      if (opts.provisionSecret === false) {
        return toPublicEndpoint(await storage.endpoints.create(newRecord, runtime));
      }
      // Mint the endpoint's initial primary signing secret from the resolved
      // strategy (per-endpoint signing, else the outbound default, else HMAC v1),
      // atomically with the endpoint row. For v1a the public key is stored so
      // publicJwks() surfaces the key without waiting for a first rotation.
      const resolvedSigning = opts.signing ?? defaults.signing;
      const algorithm: SecretAlgorithm = resolvedSigning?.kind === "ed25519-v1a" ? "v1a" : "v1";
      const provision = async (tx: unknown): Promise<EndpointRecord> => {
        const txOpt = tx !== undefined ? { tx } : undefined;
        const created = await storage.endpoints.create(newRecord, txOpt);
        const material = await mintSecretMaterial(algorithm);
        await storage.secrets.insert(
          {
            id: newSecretId(),
            endpointId: created.id,
            algorithm,
            status: "primary",
            priority: 0,
            encryptedValue: material.encryptedValue,
            ...(material.publicKey !== undefined ? { publicKey: material.publicKey } : {}),
            notAfter: null,
          },
          txOpt,
        );
        return created;
      };
      const rec =
        runtime?.tx !== undefined
          ? await provision(runtime.tx)
          : await storage.transaction(provision);
      return toPublicEndpoint(rec);
    },
    async update(id, opts, runtime) {
      assertHttpWired(opts.http, "endpoint");
      // URL-affecting fields must re-run create-time validation against the
      // effective (post-patch) values, otherwise a safe HTTPS endpoint could be
      // downgraded to a cleartext or SSRF-eligible URL.
      if (opts.url !== undefined || opts.allowHttp !== undefined || opts.http !== undefined) {
        const current = await storage.endpoints.get(id, runtime);
        if (!current) throw new EndpointNotFound(`endpoint not found: ${id}`);
        const effectiveUrl = opts.url ?? current.url;
        const effectiveAllowHttp = opts.allowHttp ?? current.allowHttp;
        const effectiveHttp = opts.http ?? (current.http as HttpDefaults | null) ?? undefined;
        await validateEndpointUrl({
          url: effectiveUrl,
          allowHttp: effectiveAllowHttp,
          ssrfPolicy: resolveSsrfPolicy(effectiveHttp?.ssrf),
        });
      }
      const patch: { -readonly [K in keyof EndpointRecord]?: EndpointRecord[K] } = {};
      if (opts.url !== undefined) patch.url = opts.url;
      if (opts.types !== undefined) patch.types = opts.types;
      if (opts.channels !== undefined) patch.channels = opts.channels;
      if (opts.retryPolicy !== undefined) patch.retryPolicy = opts.retryPolicy;
      if (opts.headers !== undefined) patch.headers = opts.headers;
      if (opts.signing !== undefined) patch.signing = opts.signing;
      if (opts.metadata !== undefined) patch.metadata = opts.metadata;
      if (opts.allowHttp !== undefined) patch.allowHttp = opts.allowHttp;
      if (opts.maxInflight !== undefined) patch.maxInflight = opts.maxInflight;
      if (opts.http !== undefined) patch.http = opts.http;
      if (opts.circuitBreaker !== undefined) patch.circuitBreaker = opts.circuitBreaker;
      if (opts.autoDisable !== undefined) patch.autoDisable = opts.autoDisable;
      if (opts.tenantId !== undefined) patch.tenantId = opts.tenantId;
      if (opts.filter !== undefined) patch.filter = opts.filter;
      if (opts.transform !== undefined) patch.transform = opts.transform;
      const rec = await storage.endpoints.update(id, patch, runtime);
      return toPublicEndpoint(rec);
    },
    async delete(id, opts) {
      const purgeAttempts = opts?.purgeAttempts === true;
      const tx = opts?.tx;
      const deleteOpts: { purgeAttempts?: boolean; tx?: unknown } = { purgeAttempts };
      if (tx !== undefined) deleteOpts.tx = tx;
      await storage.endpoints.delete(id, deleteOpts);
    },
    async list(opts) {
      const args: { tenantId?: string; tx?: unknown } = {};
      if (opts?.tenantId !== undefined) args.tenantId = opts.tenantId;
      if (opts?.tx !== undefined) args.tx = opts.tx;
      const recs = await storage.endpoints.list(args);
      return recs.map(toPublicEndpoint);
    },
    async get(id, opts) {
      const rec = await storage.endpoints.get(id, opts);
      if (!rec) throw new EndpointNotFound(`endpoint not found: ${id}`);
      return toPublicEndpoint(rec);
    },
    async disable(id, opts) {
      await storage.endpoints.transitionState(
        id,
        "disabled" satisfies EndpointState,
        "manual",
        "system",
        undefined,
        opts,
      );
    },
  };
}
