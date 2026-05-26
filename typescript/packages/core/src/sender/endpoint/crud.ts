import { bytesToBase64 } from "../../internal/base64.js";
import type { Endpoint, EndpointCreateOptions, EndpointUpdateOptions } from "../../outbound.js";
import type { EndpointRecord, EndpointState, Storage } from "../../storage/types.js";
import { DEFAULT_SSRF_POLICY, type SsrfPolicy } from "../dispatcher/ssrf.js";
import { validateEndpointUrl } from "./url-validation.js";

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
  return {
    async create(opts, runtime) {
      const allowHttp = opts.allowHttp === true;
      const ssrfPolicy = ((): SsrfPolicy => {
        const base = ssrfDefault;
        const perEndpoint = opts.http?.ssrf;
        if (!perEndpoint) return base;
        return {
          blockPrivateRanges: perEndpoint.blockPrivateRanges ?? base.blockPrivateRanges,
          allowedRanges: perEndpoint.allowedRanges ?? base.allowedRanges,
        };
      })();
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
        },
        runtime,
      );
      return toPublicEndpoint(rec);
    },
    async update(id, opts, runtime) {
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
