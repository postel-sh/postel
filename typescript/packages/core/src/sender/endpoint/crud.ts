import { bytesToBase64 } from "../../internal/base64.js";
import type {
  Endpoint,
  EndpointCreateOptions,
  EndpointUpdateOptions,
  HttpDefaults,
} from "../../outbound.js";
import type { EndpointRecord, EndpointState, Storage } from "../../storage/types.js";
import { DEFAULT_SSRF_POLICY, type SsrfPolicy } from "../dispatcher/ssrf.js";
import { validateEndpointUrl } from "./url-validation.js";

type SsrfOverride = HttpDefaults["ssrf"];

export interface EndpointDefaults {
  readonly ssrf?: SsrfPolicy;
}

function newEndpointId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `ep_${bytesToBase64(bytes).replace(/[+/=]/g, "")}`;
}

function toPublicEndpoint(rec: EndpointRecord): Endpoint {
  const out: {
    -readonly [K in keyof Endpoint]: Endpoint[K];
  } = {
    id: rec.id,
    url: rec.url,
    state: rec.state,
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
      const allowHttp = opts.allowHttp === true;
      const ssrfPolicy = resolveSsrfPolicy(opts.http?.ssrf);
      await validateEndpointUrl({ url: opts.url, allowHttp, ssrfPolicy });
      const rec = await storage.endpoints.create(
        {
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
        },
        runtime,
      );
      return toPublicEndpoint(rec);
    },
    async update(id, opts, runtime) {
      // URL-affecting fields must re-run create-time validation against the
      // effective (post-patch) values, otherwise a safe HTTPS endpoint could be
      // downgraded to a cleartext or SSRF-eligible URL.
      if (opts.url !== undefined || opts.allowHttp !== undefined || opts.http !== undefined) {
        const current = await storage.endpoints.get(id, runtime);
        if (!current) throw new Error(`endpoint not found: ${id}`);
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
      if (!rec) throw new Error(`endpoint not found: ${id}`);
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
