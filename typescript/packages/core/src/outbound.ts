import { NotImplementedError } from "./errors.js";
import type { KmsStrategy } from "./strategies/kms.js";
import type { RetryStrategy } from "./strategies/retry.js";
import type { SigningStrategy } from "./strategies/signing.js";
import type { WorkerStrategy } from "./strategies/workers.js";

export interface OutboundConfig {
  readonly storage: unknown;
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
    generateAsymmetric(): AsymmetricKeypair;
  };
  tenants: {
    setRateLimit(tenantId: string, opts: SetRateLimitOptions): Promise<void>;
    delete(tenantId: string, opts?: { tx?: unknown }): Promise<void>;
  };
  replay(opts: ReplayOptions): Promise<ReplayResult>;
  reconcile(opts: ReconcileOptions): Promise<ReadonlyArray<MessageId>>;
}

function notImplemented(symbol: string): never {
  throw new NotImplementedError(symbol);
}

export function buildOutboundApi(_config: OutboundConfig): OutboundApi {
  return {
    async send() {
      return notImplemented("postel.outbound.send");
    },
    endpoints: {
      async create() {
        return notImplemented("postel.outbound.endpoints.create");
      },
      async update() {
        return notImplemented("postel.outbound.endpoints.update");
      },
      async delete() {
        return notImplemented("postel.outbound.endpoints.delete");
      },
      async list() {
        return notImplemented("postel.outbound.endpoints.list");
      },
      async get() {
        return notImplemented("postel.outbound.endpoints.get");
      },
      async disable() {
        return notImplemented("postel.outbound.endpoints.disable");
      },
      async rotateSecret() {
        return notImplemented("postel.outbound.endpoints.rotateSecret");
      },
    },
    keys: {
      generateSymmetric() {
        return notImplemented("postel.outbound.keys.generateSymmetric");
      },
      generateAsymmetric() {
        return notImplemented("postel.outbound.keys.generateAsymmetric");
      },
    },
    tenants: {
      async setRateLimit() {
        return notImplemented("postel.outbound.tenants.setRateLimit");
      },
      async delete() {
        return notImplemented("postel.outbound.tenants.delete");
      },
    },
    async replay() {
      return notImplemented("postel.outbound.replay");
    },
    async reconcile() {
      return notImplemented("postel.outbound.reconcile");
    },
  };
}
