import { type Clock, systemClock } from "./clock.js";
import { NotImplementedError } from "./errors.js";
import { assertHttpWired } from "./internal/config-guards.js";
import { ed25519Jwk, ed25519Kid } from "./internal/jwk.js";
import type { CursorOptions, Page } from "./pagination.js";
import { buildHttpDispatcher } from "./sender/dispatcher/http-dispatcher.js";
import { buildEndpointApi } from "./sender/endpoint/crud.js";
import { PostelEventEmitter } from "./sender/events.js";
import { generateAsymmetric, generateSymmetric } from "./sender/keys/generate.js";
import { rotateSecret } from "./sender/keys/rotation.js";
import { reconcileImpl, replayImpl } from "./sender/replay/replay.js";
import { buildRetryDispatcher } from "./sender/retry/orchestrator.js";
import { sendImpl } from "./sender/send.js";
import { WorkerPool } from "./sender/worker/pool.js";
import type {
  AttemptStatus,
  MessageListFilter,
  MessageStatus,
  Storage,
  StoredMessage,
  TenantListFilter,
  TenantRecord,
} from "./storage/types.js";
import type { KmsStrategy } from "./strategies/kms.js";
import { FixedRate } from "./strategies/rate-limit.js";
import type { RateLimitStrategy } from "./strategies/rate-limit.js";
import type { RetryStrategy } from "./strategies/retry.js";
import type { SigningStrategy } from "./strategies/signing.js";
import type { WorkerStrategy } from "./strategies/workers.js";
import type { Jwk, Jwks } from "./types.js";

export interface OutboundConfig<TTx = unknown> {
  readonly storage: Storage<TTx>;
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

export interface SendResult {
  readonly id: MessageId;
  readonly reused: boolean;
}

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

export interface SendOptions<TTx = unknown> {
  readonly tx?: TTx;
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
  readonly provisionSecret?: boolean;
}

export interface EndpointUpdateOptions extends Partial<EndpointCreateOptions> {}

// The public read shape for endpoints: every accepted serializable field
// round-trips through create/get/list/update. Function-shaped options
// (`filter`, `transform`, callable `headers`) are code-side JS values and stay
// off this shape; `signing` stays off because a strategy can carry key material.
export interface Endpoint {
  readonly id: string;
  readonly url: string;
  readonly state: "active" | "disabled" | "circuit-open";
  readonly types: ReadonlyArray<string> | null;
  readonly channels: ReadonlyArray<string> | null;
  readonly retryPolicy: RetryStrategy | null;
  readonly headers: Readonly<Record<string, string>> | null;
  readonly allowHttp: boolean;
  readonly maxInflight: number | null;
  readonly http: HttpDefaults | null;
  readonly circuitBreaker: CircuitBreakerDefaults | null;
  readonly autoDisable: AutoDisableDefaults | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly tenantId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface RotateSecretOptions<TTx = unknown> {
  readonly keepPreviousFor: number | string;
  readonly tx?: TTx;
}

export interface AsymmetricKeypair {
  readonly private: string;
  readonly public: string;
}

export interface SetRateLimitOptions<TTx = unknown> {
  readonly perSecond: number;
  readonly tx?: TTx;
}

export type ReplayOptions<TTx = unknown> =
  | { readonly messageId: string; readonly freshWebhookId: boolean; readonly tx?: TTx }
  | {
      readonly endpointId: string;
      readonly since: Date | string;
      readonly until?: Date | string;
      readonly types?: ReadonlyArray<string>;
      readonly replayThroughput?: number;
      readonly freshWebhookId: boolean;
      readonly tx?: TTx;
    }
  | {
      readonly filter: (msg: unknown) => boolean;
      readonly replayThroughput?: number;
      readonly freshWebhookId: boolean;
      readonly tx?: TTx;
    };

export interface ReplayResult {
  readonly enqueued: number;
}

export interface ReconcileOptions<TTx = unknown> {
  readonly endpointId: string;
  readonly since: Date | string;
  readonly tx?: TTx;
}

// A stored outbound message as returned by the introspection reads: metadata +
// the original event payload. `status` is the message-level outbox lifecycle
// (`MessageStatus`); per-endpoint delivery outcomes are on DeliveryAttempt.status.
export interface Message<TData = unknown> {
  readonly id: MessageId;
  readonly type: string;
  readonly data: TData;
  readonly channels: ReadonlyArray<string> | null;
  readonly idempotencyKey: string | null;
  readonly version: string | null;
  readonly tenantId: string | null;
  readonly ttlSeconds: number | null;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly status: MessageStatus;
  readonly attemptNumber: number;
  readonly scheduledFor: Date | null;
  readonly replayOf: MessageId | null;
}

// A single delivery attempt against one endpoint, with its status, response,
// latency, and replay tag.
export interface DeliveryAttempt {
  readonly id: string;
  readonly messageId: MessageId;
  readonly endpointId: string;
  readonly tenantId: string | null;
  readonly attemptNumber: number;
  readonly status: AttemptStatus;
  readonly scheduledFor: Date | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly responseCode: number | null;
  readonly responseHeaders: Readonly<Record<string, string>> | null;
  readonly responseBody: string | null;
  readonly latencyMs: number | null;
  readonly error: string | null;
  readonly replayOf: MessageId | null;
}

export interface MessageListOptions {
  readonly tenantId?: string;
  readonly types?: ReadonlyArray<string>;
  readonly status?: MessageStatus | ReadonlyArray<MessageStatus>;
  readonly since?: Date | string;
  readonly until?: Date | string;
  readonly limit?: number;
}

// Read-shaped tenant for the tenant-read surface. `rateLimit` is decoded from
// the storage-level `TenantRecord.metadata.rateLimit` into a typed strategy;
// `metadata` is still exposed raw for anything else a host stashed there.
export interface Tenant {
  readonly id: string;
  readonly rateLimit: RateLimitStrategy | null;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly createdAt: Date;
}

export interface TenantListOptions extends CursorOptions {}

export type TenantPage = Page<Tenant>;

export interface OutboundApi<TTx = unknown> {
  send<TData = unknown>(event: SendEvent<TData>, options?: SendOptions<TTx>): Promise<SendResult>;
  endpoints: {
    create(opts: EndpointCreateOptions, runtime?: { tx?: TTx }): Promise<Endpoint>;
    update(id: string, opts: EndpointUpdateOptions, runtime?: { tx?: TTx }): Promise<Endpoint>;
    delete(id: string, opts?: { purgeAttempts?: boolean; tx?: TTx }): Promise<void>;
    list(opts?: { tenantId?: string; tx?: TTx }): Promise<ReadonlyArray<Endpoint>>;
    get(id: string, opts?: { tx?: TTx }): Promise<Endpoint>;
    disable(id: string, opts?: { tx?: TTx }): Promise<void>;
    rotateSecret(id: string, opts: RotateSecretOptions<TTx>): Promise<void>;
  };
  keys: {
    generateSymmetric(): string;
    generateAsymmetric(): Promise<AsymmetricKeypair>;
    publicJwks(opts?: { tenantId?: string; tx?: TTx }): Promise<Jwks>;
  };
  tenants: {
    setRateLimit(tenantId: string, opts: SetRateLimitOptions<TTx>): Promise<void>;
    delete(tenantId: string, opts?: { tx?: TTx }): Promise<void>;
    get(id: string, opts?: { tx?: TTx }): Promise<Tenant | undefined>;
    list(opts?: TenantListOptions): Promise<TenantPage>;
  };
  replay(opts: ReplayOptions<TTx>): Promise<ReplayResult>;
  reconcile(opts: ReconcileOptions<TTx>): Promise<ReadonlyArray<MessageId>>;
  messages: {
    get<TData = unknown>(id: string, opts?: { tx?: TTx }): Promise<Message<TData> | undefined>;
    attempts(id: string): Promise<ReadonlyArray<DeliveryAttempt>>;
    list(opts?: MessageListOptions): Promise<ReadonlyArray<Message>>;
  };
}

export interface OutboundRuntime<TTx = unknown> {
  readonly api: OutboundApi<TTx>;
  readonly pool: WorkerPool;
  readonly storage: Storage<TTx>;
  readonly clock: Clock;
  readonly emitter: PostelEventEmitter;
}

function notImplemented(symbol: string): never {
  throw new NotImplementedError(symbol);
}

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`invalid date: ${String(value)}`);
  }
  return date;
}

function toMessage<TData = unknown>(m: StoredMessage): Message<TData> {
  return { ...m, data: m.data as TData };
}

function toRateLimitStrategy(raw: unknown): RateLimitStrategy | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as { kind?: unknown; perSecond?: unknown };
  if (typeof obj.perSecond !== "number") return null;
  // "fixed" is the only kind today; a bare legacy `{ perSecond }` (written
  // before this strategy type existed) or an unrecognized `kind` also decodes
  // as fixed rather than being dropped, since perSecond is the only field that
  // ever mattered for dispatch throttling.
  return FixedRate({ perSecond: obj.perSecond });
}

function toTenant(rec: TenantRecord): Tenant {
  const { rateLimit } = rec.metadata ?? {};
  return {
    id: rec.id,
    rateLimit: toRateLimitStrategy(rateLimit),
    metadata: rec.metadata,
    createdAt: rec.createdAt,
  };
}

export function buildOutboundRuntime<TTx = unknown>(
  config: OutboundConfig<TTx>,
): OutboundRuntime<TTx> {
  const clock: Clock = config.clock ?? systemClock;
  const emitter = new PostelEventEmitter();
  if (config.workers && config.workers.kind !== "in-process") {
    // Only the in-process worker pool ships in this release. BullMQ / PgBoss /
    // external-adapter strategies are tagged config slots with no runtime yet —
    // fail fast rather than silently running them in-process.
    notImplemented(`Worker strategy '${config.workers.kind}' (only 'in-process' is supported)`);
  }
  // Typed-but-unshipped slots fail fast at construction rather than accepting a
  // value the runtime silently ignores. See `Unimplemented config slots fail
  // fast at construction` in openspec/specs/api-surface-typescript/spec.md.
  if (config.kms && config.kms.kind !== "plaintext") {
    notImplemented(
      `KMS strategy '${config.kms.kind}' (only PlaintextKms is supported; envelope encryption has not shipped)`,
    );
  }
  if (config.retention) {
    notImplemented("retention (automatic pruning has not shipped)");
  }
  if (config.ephemeralKeys) {
    notImplemented("ephemeralKeys (timer-driven key rotation has not shipped)");
  }
  assertHttpWired(config.http, "outbound");
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
  const endpointApi = buildEndpointApi(config.storage, {
    ...(config.http?.ssrf
      ? {
          ssrf: {
            blockPrivateRanges: config.http.ssrf.blockPrivateRanges ?? true,
            allowedRanges: config.http.ssrf.allowedRanges ?? [],
          },
        }
      : {}),
    ...(config.signing !== undefined ? { signing: config.signing } : {}),
  });
  const api: OutboundApi<TTx> = {
    async send<TData = unknown>(event: SendEvent<TData>, options?: SendOptions<TTx>) {
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
        await rotateSecret(config.storage, clock, id, {
          keepPreviousFor: opts.keepPreviousFor,
          ...(opts.tx !== undefined ? { tx: opts.tx } : {}),
        });
      },
    },
    keys: {
      generateSymmetric() {
        return generateSymmetric();
      },
      async generateAsymmetric() {
        return generateAsymmetric();
      },
      async publicJwks(opts) {
        const listArgs: { tenantId?: string; tx?: TTx } = {};
        if (opts?.tenantId !== undefined) listArgs.tenantId = opts.tenantId;
        if (opts?.tx !== undefined) listArgs.tx = opts.tx;
        const endpoints = await config.storage.endpoints.list(listArgs);
        const now = clock.now();
        const seen = new Set<string>();
        const keys: Jwk[] = [];
        for (const ep of endpoints) {
          const secrets = await config.storage.secrets.listForEndpoint(ep.id);
          for (const s of secrets) {
            if (s.algorithm !== "v1a" || !s.publicKey) continue;
            if (s.status !== "primary" && s.status !== "verifying") continue;
            if (s.notAfter && s.notAfter.getTime() <= now.getTime()) continue;
            const kid = await ed25519Kid(s.publicKey);
            if (seen.has(kid)) continue;
            seen.add(kid);
            keys.push(ed25519Jwk(s.publicKey, kid));
          }
        }
        return { keys };
      },
    },
    tenants: {
      async setRateLimit(tenantId, opts) {
        const existing = await config.storage.tenants.get(tenantId);
        const metadata = {
          ...(existing?.metadata ?? {}),
          rateLimit: FixedRate({ perSecond: opts.perSecond }),
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
      async get(id, opts) {
        const rec = await config.storage.tenants.get(
          id,
          opts?.tx !== undefined ? { tx: opts.tx } : undefined,
        );
        return rec ? toTenant(rec) : undefined;
      },
      async list(opts) {
        // A non-positive or non-integer limit is a caller error, not a silent
        // default — same guard as `messages.list`.
        if (opts?.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit <= 0)) {
          throw new RangeError(`limit must be a positive integer, received ${String(opts.limit)}`);
        }
        const filter: { -readonly [K in keyof TenantListFilter]?: TenantListFilter[K] } = {};
        if (opts?.limit !== undefined) filter.limit = opts.limit;
        if (opts?.cursor !== undefined) filter.cursor = opts.cursor;
        const page = await config.storage.tenants.list(filter);
        return { items: page.items.map(toTenant), nextCursor: page.nextCursor };
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
    messages: {
      async get<TData = unknown>(id: string, opts?: { tx?: TTx }) {
        const stored = await config.storage.getMessage(
          id,
          opts?.tx !== undefined ? { tx: opts.tx } : undefined,
        );
        return stored ? toMessage<TData>(stored) : undefined;
      },
      async attempts(id: string) {
        return config.storage.attempts.latestForMessage(id);
      },
      async list(opts?: MessageListOptions) {
        const filter: {
          -readonly [K in keyof MessageListFilter]?: MessageListFilter[K];
        } = {};
        if (opts?.tenantId !== undefined) filter.tenantId = opts.tenantId;
        if (opts?.types !== undefined) filter.types = opts.types;
        if (opts?.status !== undefined) {
          filter.status = Array.isArray(opts.status) ? opts.status : [opts.status];
        }
        if (opts?.since !== undefined) filter.since = toDate(opts.since);
        if (opts?.until !== undefined) filter.until = toDate(opts.until);
        if (opts?.limit !== undefined) {
          // A non-positive or non-integer limit is a caller error, not a
          // silent default: `LIMIT -1` is "no limit" on some dialects.
          if (!Number.isInteger(opts.limit) || opts.limit <= 0) {
            throw new RangeError(
              `limit must be a positive integer, received ${String(opts.limit)}`,
            );
          }
          filter.limit = opts.limit;
        }
        const rows = await config.storage.listMessages(filter);
        return rows.map((m) => toMessage(m));
      },
    },
  };
  return { api, pool, storage: config.storage, clock, emitter };
}

export function buildOutboundApi<TTx = unknown>(config: OutboundConfig<TTx>): OutboundApi<TTx> {
  return buildOutboundRuntime(config).api;
}
