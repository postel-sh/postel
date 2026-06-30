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
import type { Storage } from "./storage/types.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

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

export type Logger = (entry: LogEvent) => void;

export interface ObservabilityConfig {
  readonly logger?: Logger;
}

export interface HealthStatus {
  readonly ok: boolean;
  readonly outboxDepth?: number;
  readonly oldestPendingAge?: number | undefined;
  readonly workerCount?: number;
}

export interface LifecycleApi {
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<HealthStatus>;
  on(event: PostelEvent, handler: EventHandler): void;
  off(event: PostelEvent, handler: EventHandler): void;
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
    emitter.on("attempt", (p) =>
      logger({ event: "attempt", level: "debug", data: p as AttemptPayload }),
    );
    emitter.on("circuit-open", (p) =>
      logger({ event: "circuit-open", level: "warn", data: p as CircuitTransitionPayload }),
    );
    emitter.on("circuit-close", (p) =>
      logger({ event: "circuit-close", level: "info", data: p as CircuitTransitionPayload }),
    );
    emitter.on("dead-letter", (p) =>
      logger({ event: "dead-letter", level: "error", data: p as DeadLetterPayload }),
    );
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
      const depth = await outboundRuntime.storage.outboxDepth();
      return {
        ok: true,
        outboxDepth: depth.depth,
        oldestPendingAge: depth.oldestPendingAge,
        workerCount: outboundRuntime.pool.workerCount(),
      };
    },
    on(event, handler) {
      emitter.on(event, handler);
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
