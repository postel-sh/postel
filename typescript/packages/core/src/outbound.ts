import { type Clock, systemClock } from "./clock.js";
import { NotImplementedError } from "./errors.js";
import { buildHttpDispatcher } from "./sender/dispatcher/http-dispatcher.js";
import { buildEndpointApi } from "./sender/endpoint/crud.js";
import { PostelEventEmitter } from "./sender/events.js";
import { generateAsymmetric, generateSymmetric } from "./sender/keys/generate.js";
import { rotateSecret } from "./sender/keys/rotation.js";
import { reconcileImpl, replayImpl } from "./sender/replay/replay.js";
import { buildRetryDispatcher } from "./sender/retry/orchestrator.js";
import { sendImpl } from "./sender/send.js";
import { WorkerPool } from "./sender/worker/pool.js";
import type { Storage } from "./storage/types.js";
import type { KmsStrategy } from "./strategies/kms.js";
import type { RetryStrategy } from "./strategies/retry.js";
import type { SigningStrategy } from "./strategies/signing.js";
import type { WorkerStrategy } from "./strategies/workers.js";

export interface OutboundConfig {
  readonly storage: Storage;
  readonly signing?: SigningStrategy;
  readonly retryPolicy?: RetryStrategy;
  readonly workers?: WorkerStrategy;
  readonly kms?: KmsStrategy;
  readonly http?: HttpDefaults;
  readonly circuitBreaker?: CircuitBreakerDefaults;
  readonly autoDisable?: AutoDisableDefaults;
  readonly replay?: ReplayDefaults;
  readonly retention?: RetentionDefaults;
  readonly ephemeralKeys?: EphemeralKeysDefaults;
  readonly clock?: Clock;
  readonly defaultTenantId?: string | null;
}

export interface HttpDefaults {
  readonly requestTimeout?: number | string;
  readonly overallDeadline?: number | string;
  readonly tls?: { readonly verify?: boolean };
  readonly dns?: { readonly pinResolution?: boolean };
  readonly ssrf?: {
    readonly blockPrivateRanges?: boolean;
    readonly allowedRanges?: ReadonlyArray<string>;
  };
  readonly userAgent?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface CircuitBreakerDefaults {
  readonly threshold?: number;
  readonly cooldown?: number | string;
}

export interface AutoDisableDefaults {
  readonly failureRate?: number;
  readonly window?: number | string;
  readonly minAttempts?: number;
}

export interface ReplayDefaults {
  readonly defaultThroughput?: number;
}

export interface RetentionDefaults {
  readonly messages?: number | string;
  readonly attempts?: number | string;
}

export interface EphemeralKeysDefaults {
  readonly rotateEvery: number | string;
}

export type MessageId = string;

export interface SendEvent<TData = unknown> {
  readonly type: string;
  readonly data?: TData;
  readonly channels?: ReadonlyArray<string>;
  readonly idempotencyKey?: string;
  readonly version?: string;
  readonly timestamp?: string | Date;
  readonly ttl?: number | string;
  readonly tenantId?: string;
}

export interface SendOptions {
  readonly tx?: unknown;
}

export interface EndpointCreateOptions {
  readonly url: string;
  readonly types?: ReadonlyArray<string>;
  readonly channels?: ReadonlyArray<string>;
  readonly filter?: (event: unknown) => boolean;
  readonly transform?: (event: unknown) => unknown;
  readonly retryPolicy?: RetryStrategy;
  readonly headers?:
    | Record<string, string>
    | ((ctx: { message: unknown }) => Record<string, string>);
  readonly signing?: SigningStrategy;
  readonly circuitBreaker?: CircuitBreakerDefaults;
  readonly autoDisable?: AutoDisableDefaults;
  readonly http?: HttpDefaults;
  readonly metadata?: Record<string, unknown>;
  readonly tenantId?: string;
  readonly allowHttp?: boolean;
  readonly maxInflight?: number;
}

export interface EndpointUpdateOptions extends Partial<EndpointCreateOptions> {}

export interface Endpoint {
  readonly id: string;
  readonly url: string;
  readonly state: "active" | "disabled" | "circuit-open";
  readonly tenantId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface RotateSecretOptions {
  readonly keepPreviousFor: number | string;
  readonly tx?: unknown;
}

export interface AsymmetricKeypair {
  readonly private: string;
  readonly public: string;
}

export interface SetRateLimitOptions {
  readonly perSecond: number;
  readonly tx?: unknown;
}

export type ReplayOptions =
  | { readonly messageId: string; readonly freshWebhookId: boolean; readonly tx?: unknown }
  | {
      readonly endpointId: string;
      readonly since: Date | string;
      readonly until?: Date | string;
      readonly types?: ReadonlyArray<string>;
      readonly replayThroughput?: number;
      readonly freshWebhookId: boolean;
      readonly tx?: unknown;
    }
  | {
      readonly filter: (msg: unknown) => boolean;
      readonly replayThroughput?: number;
      readonly freshWebhookId: boolean;
      readonly tx?: unknown;
    };

export interface ReplayResult {
  readonly enqueued: number;
}

export interface ReconcileOptions {
  readonly endpointId: string;
  readonly since: Date | string;
  readonly tx?: unknown;
}

export interface OutboundApi {
  send<TData = unknown>(event: SendEvent<TData>, options?: SendOptions): Promise<MessageId>;
  endpoints: {
    create(opts: EndpointCreateOptions, runtime?: { tx?: unknown }): Promise<Endpoint>;
    update(id: string, opts: EndpointUpdateOptions, runtime?: { tx?: unknown }): Promise<Endpoint>;
    delete(id: string, opts?: { purgeAttempts?: boolean; tx?: unknown }): Promise<void>;
    list(opts?: { tenantId?: string; tx?: unknown }): Promise<ReadonlyArray<Endpoint>>;
    get(id: string, opts?: { tx?: unknown }): Promise<Endpoint>;
    disable(id: string, opts?: { tx?: unknown }): Promise<void>;
    rotateSecret(id: string, opts: RotateSecretOptions): Promise<void>;
  };
  keys: {
    generateSymmetric(): string;
    generateAsymmetric(): Promise<AsymmetricKeypair>;
  };
  tenants: {
    setRateLimit(tenantId: string, opts: SetRateLimitOptions): Promise<void>;
    delete(tenantId: string, opts?: { tx?: unknown }): Promise<void>;
  };
  replay(opts: ReplayOptions): Promise<ReplayResult>;
  reconcile(opts: ReconcileOptions): Promise<ReadonlyArray<MessageId>>;
}

export interface OutboundRuntime {
  readonly api: OutboundApi;
  readonly pool: WorkerPool;
  readonly storage: Storage;
  readonly clock: Clock;
  readonly emitter: PostelEventEmitter;
}

function notImplemented(symbol: string): never {
  throw new NotImplementedError(symbol);
}

export function buildOutboundRuntime(config: OutboundConfig): OutboundRuntime {
  const clock: Clock = config.clock ?? systemClock;
  const emitter = new PostelEventEmitter();
  const concurrency = config.workers?.kind === "in-process" ? config.workers.concurrency : 4;
  const fetchImpl = config.http?.fetch ?? globalThis.fetch;
  const httpDispatcher = buildHttpDispatcher({
    storage: config.storage,
    clock,
    fetchImpl,
    defaults: config.http ?? {},
  });
  const retryDispatcher = buildRetryDispatcher(
    {
      storage: config.storage,
      clock,
      emitter,
      ...(config.retryPolicy !== undefined ? { orgRetryPolicy: config.retryPolicy } : {}),
      ...(config.circuitBreaker !== undefined ? { orgCircuitBreaker: config.circuitBreaker } : {}),
      ...(config.autoDisable !== undefined ? { orgAutoDisable: config.autoDisable } : {}),
    },
    httpDispatcher,
  );
  const pool = new WorkerPool({
    storage: config.storage,
    clock,
    concurrency,
    dispatchOne: retryDispatcher,
  });
  const endpointApi = buildEndpointApi(
    config.storage,
    config.http?.ssrf
      ? {
          ssrf: {
            blockPrivateRanges: config.http.ssrf.blockPrivateRanges ?? true,
            allowedRanges: config.http.ssrf.allowedRanges ?? [],
          },
        }
      : {},
  );
  const api: OutboundApi = {
    async send<TData = unknown>(event: SendEvent<TData>, options?: SendOptions) {
      return sendImpl(
        { storage: config.storage, clock, defaultTenantId: config.defaultTenantId ?? null },
        event,
        options,
      );
    },
    endpoints: {
      create: endpointApi.create,
      update: endpointApi.update,
      delete: endpointApi.delete,
      list: endpointApi.list,
      get: endpointApi.get,
      disable: endpointApi.disable,
      async rotateSecret(id, opts) {
        await rotateSecret(config.storage, clock, id, { keepPreviousFor: opts.keepPreviousFor });
      },
    },
    keys: {
      generateSymmetric() {
        return generateSymmetric();
      },
      async generateAsymmetric() {
        return generateAsymmetric();
      },
    },
    tenants: {
      async setRateLimit(tenantId, opts) {
        const existing = await config.storage.tenants.get(tenantId);
        const metadata = {
          ...(existing?.metadata ?? {}),
          rateLimit: { perSecond: opts.perSecond },
        } as Readonly<Record<string, unknown>>;
        await config.storage.tenants.upsert(
          tenantId,
          metadata,
          opts.tx !== undefined ? { tx: opts.tx } : undefined,
        );
      },
      async delete(tenantId, opts) {
        await config.storage.tenants.delete(
          tenantId,
          opts?.tx !== undefined ? { tx: opts.tx } : undefined,
        );
      },
    },
    async replay(opts) {
      const replayCtx: { storage: Storage; clock: Clock; defaultThroughput?: number } = {
        storage: config.storage,
        clock,
      };
      if (config.replay?.defaultThroughput !== undefined) {
        replayCtx.defaultThroughput = config.replay.defaultThroughput;
      }
      return replayImpl(replayCtx, opts);
    },
    async reconcile(opts) {
      return reconcileImpl({ storage: config.storage, clock }, opts.endpointId, opts.since);
    },
  };
  void notImplemented;
  return { api, pool, storage: config.storage, clock, emitter };
}

export function buildOutboundApi(config: OutboundConfig): OutboundApi {
  return buildOutboundRuntime(config).api;
}
