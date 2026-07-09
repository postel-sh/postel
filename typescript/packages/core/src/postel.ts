import { type InboundApi, type InboundSource, buildInboundApi } from "./inbound.js";
import {
  type OutboundApi,
  type OutboundConfig,
  type OutboundRuntime,
  buildOutboundRuntime,
} from "./outbound.js";
import {
  type AttemptPayload,
  type CircuitTransitionPayload,
  type DeadLetterPayload,
  type EventHandler,
  type PostelEvent,
  PostelEventEmitter,
} from "./sender/events.js";
import type { Storage, Unsubscribe } from "./storage/types.js";
import { ttlToSeconds } from "./ttl.js";

// A forwarded runtime event. The library forwards the same events surfaced by
// `postel.on(...)` to `observability.logger` with a severity level. See
// `Logger pass-through for runtime events` in openspec/specs/observability/spec.md.
export type LogEvent =
  | { readonly event: "attempt"; readonly level: "debug"; readonly data: AttemptPayload }
  | {
      readonly event: "circuit-open";
      readonly level: "warn";
      readonly data: CircuitTransitionPayload;
    }
  | {
      readonly event: "circuit-close";
      readonly level: "info";
      readonly data: CircuitTransitionPayload;
    }
  | { readonly event: "dead-letter"; readonly level: "error"; readonly data: DeadLetterPayload };

// Derived from LogEvent so the two can't drift as events/levels are added.
export type LogLevel = LogEvent["level"];

export type Logger = (entry: LogEvent) => void;

// Thresholds that let `health()` report `ok: false` on a degraded-but-reachable
// outbox. Durations use the shared `number | "<integer><s|m|h|d>"` grammar.
export interface HealthThresholds {
  readonly maxOutboxDepth?: number;
  readonly maxOldestPendingAge?: number | string;
}

export interface ObservabilityConfig {
  readonly logger?: Logger;
  readonly health?: HealthThresholds;
}

export interface HealthStatus {
  readonly ok: boolean;
  readonly outboxDepth?: number;
  readonly oldestPendingAge?: number | undefined;
  readonly workerCount?: number;
  // Present only when `ok` is false: names the failing condition.
  readonly reason?: string;
}

export interface LifecycleApi {
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<HealthStatus>;
  on<E extends PostelEvent>(event: E, handler: EventHandler<E>): Unsubscribe;
  off<E extends PostelEvent>(event: E, handler: EventHandler<E>): void;
}

export interface PostelConfig<
  TInbound extends Record<string, InboundSource> = Record<string, InboundSource>,
> {
  readonly observability?: ObservabilityConfig;
  readonly outbound?: OutboundConfig;
  readonly inbound?: TInbound;
}

export type WithOutbound<C> = C extends {
  readonly outbound: { readonly storage: Storage<infer TTx> };
}
  ? { outbound: OutboundApi<TTx> }
  : C extends { readonly outbound: OutboundConfig }
    ? { outbound: OutboundApi }
    : object;

export type WithInbound<C> = C extends { readonly inbound: infer I }
  ? I extends Record<string, InboundSource>
    ? { inbound: InboundApi<I> }
    : object
  : object;

export type PostelInstance<C extends PostelConfig> = LifecycleApi &
  WithOutbound<C> &
  WithInbound<C>;

export function Postel<const C extends PostelConfig>(config: C): PostelInstance<C> {
  let outboundRuntime: OutboundRuntime | undefined;
  if (config.outbound) outboundRuntime = buildOutboundRuntime(config.outbound);
  const fallbackEmitter = new PostelEventEmitter();
  const emitter = outboundRuntime ? outboundRuntime.emitter : fallbackEmitter;

  const logger = config.observability?.logger;
  if (logger) {
    emitter.on("attempt", (data) => logger({ event: "attempt", level: "debug", data }));
    emitter.on("circuit-open", (data) => logger({ event: "circuit-open", level: "warn", data }));
    emitter.on("circuit-close", (data) => logger({ event: "circuit-close", level: "info", data }));
    emitter.on("dead-letter", (data) => logger({ event: "dead-letter", level: "error", data }));
  }

  const lifecycle: LifecycleApi = {
    async start() {
      if (outboundRuntime) await outboundRuntime.pool.start();
    },
    async stop() {
      if (outboundRuntime) await outboundRuntime.pool.stop();
    },
    async health() {
      if (!outboundRuntime) return { ok: true };
      const runtime = outboundRuntime;
      let depth: { depth: number; oldestPendingAge: number | undefined };
      try {
        depth = await runtime.storage.outboxDepth();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { ok: false, reason: `storage probe failed: ${detail}` };
      }
      const observed = {
        outboxDepth: depth.depth,
        oldestPendingAge: depth.oldestPendingAge,
        workerCount: runtime.pool.workerCount(),
      };
      const thresholds = config.observability?.health;
      if (thresholds?.maxOutboxDepth !== undefined && depth.depth > thresholds.maxOutboxDepth) {
        return {
          ok: false,
          ...observed,
          reason: `outbox depth ${depth.depth} exceeds maxOutboxDepth ${thresholds.maxOutboxDepth}`,
        };
      }
      if (thresholds?.maxOldestPendingAge !== undefined && depth.oldestPendingAge !== undefined) {
        const configured = thresholds.maxOldestPendingAge;
        const maxMs = ttlToSeconds(configured) * 1000;
        if (depth.oldestPendingAge > maxMs) {
          return {
            ok: false,
            ...observed,
            reason: `oldest pending age ${depth.oldestPendingAge}ms exceeds maxOldestPendingAge ${configured} (${maxMs}ms)`,
          };
        }
      }
      return { ok: true, ...observed };
    },
    on(event, handler) {
      return emitter.on(event, handler);
    },
    off(event, handler) {
      emitter.off(event, handler);
    },
  };

  return {
    ...lifecycle,
    ...(outboundRuntime ? { outbound: outboundRuntime.api } : {}),
    ...(config.inbound ? { inbound: buildInboundApi(config.inbound) } : {}),
  } as PostelInstance<C>;
}

/**
 * Identity helper that preserves a config's literal type. Annotating a config
 * with `PostelConfig` before passing it to `Postel(...)` widens the literal, so
 * the `WithInbound` / `WithOutbound` conditionals can no longer see the
 * configured slots and `postel.inbound` / `postel.outbound` vanish from the
 * instance type. Declaring the config through `definePostelConfig(...)` keeps
 * the literal and full instance typing without inlining the object.
 */
export function definePostelConfig<const C extends PostelConfig>(config: C): C {
  return config;
}
