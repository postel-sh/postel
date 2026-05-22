import { type InboundApi, type InboundSource, buildInboundApi } from "./inbound.js";
import { type OutboundApi, type OutboundConfig, buildOutboundApi } from "./outbound.js";

export interface ObservabilityConfig {
  readonly logger?: unknown;
  readonly otel?: unknown;
  readonly metrics?: unknown;
}

export interface HealthStatus {
  readonly ok: boolean;
  readonly outboxDepth?: number;
  readonly oldestPendingAge?: number;
  readonly workerCount?: number;
}

export interface LifecycleApi {
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<HealthStatus>;
}

export interface PostelConfig<
  TInbound extends Record<string, InboundSource> = Record<string, InboundSource>,
> {
  readonly observability?: ObservabilityConfig;
  readonly outbound?: OutboundConfig;
  readonly inbound?: TInbound;
}

export type WithOutbound<C> = C extends { readonly outbound: OutboundConfig }
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
  const lifecycle: LifecycleApi = {
    async start() {},
    async stop() {},
    async health() {
      return { ok: true };
    },
  };

  return {
    ...lifecycle,
    ...(config.outbound ? { outbound: buildOutboundApi(config.outbound) } : {}),
    ...(config.inbound ? { inbound: buildInboundApi(config.inbound) } : {}),
  } as PostelInstance<C>;
}
