import {
  type ComposedVerifyResult,
  ConfigurationError,
  type DeliveryAttempt,
  type EventDataOf,
  type EventOf,
  type EventsOf,
  type InboundApi,
  type InboundSource,
  type Message,
  type MessageListOptions,
  NotImplementedError,
  type OutboundApi,
  type OutboundConfig,
  type OutboundEventRegistry,
  type Page,
  Postel,
  type PostelConfig,
  PostelError,
  type PostelInstance,
  type ReplayOptions,
  type ReplayResult,
  type SendEvent,
  type SendOptions,
  type SendResult,
  type StandardSchemaV1,
  type Storage,
  type WebhookHeaders,
} from "@postel/core";
import { Context, Effect, Layer, type Scope } from "effect";

// Mirrors the unexported default in `@postel/core`'s `outbound.ts`: a
// key-less mapped type so `keyof` resolves to `never` rather than
// `string | number`, matching `EventDataOf`'s unregistered-type fallback.
type NoEventsRegistered = { readonly [K in never]: StandardSchemaV1<unknown, unknown> };

/**
 * The typed error channel every Effect-wrapped Postel operation can fail
 * with. A throw that is none of these (a programmer error such as the
 * `RangeError` `messages.list` raises on a non-positive `limit`) is NOT
 * folded in here — it surfaces as an Effect defect rather than being
 * force-typed into the recoverable channel.
 */
export type PostelErrors = PostelError | ConfigurationError | NotImplementedError;

function isPostelErrors(err: unknown): err is PostelErrors {
  return (
    err instanceof PostelError ||
    err instanceof ConfigurationError ||
    err instanceof NotImplementedError
  );
}

function wrapPromise<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  thisArg: unknown,
): (...args: A) => Effect.Effect<R, PostelErrors> {
  return (...args: A) =>
    Effect.tryPromise({
      try: () => fn.apply(thisArg, args),
      catch: (err) => {
        if (isPostelErrors(err)) return err;
        // Rethrowing here (rather than returning) turns an unrecognized
        // error into an Effect defect instead of a value of `PostelErrors`.
        throw err;
      },
    });
}

export interface PostelEffectOutboundApi<
  TTx = unknown,
  TEvents extends OutboundEventRegistry = NoEventsRegistered,
> {
  send<T extends string>(
    event: SendEvent<EventDataOf<TEvents, T>> & { readonly type: T },
    options?: SendOptions<TTx>,
  ): Effect.Effect<SendResult, PostelErrors>;
  send<TData = unknown, T extends string = string>(
    event: SendEvent<TData> & { readonly type: Exclude<T, keyof TEvents> },
    options?: SendOptions<TTx>,
  ): Effect.Effect<SendResult, PostelErrors>;
  replay(opts: ReplayOptions<TTx>): Effect.Effect<ReplayResult, PostelErrors>;
  messages: {
    get<TData = unknown>(
      id: string,
      opts?: { tx?: TTx },
    ): Effect.Effect<Message<TData> | undefined, PostelErrors>;
    attempts(id: string): Effect.Effect<ReadonlyArray<DeliveryAttempt>, PostelErrors>;
    list(opts?: MessageListOptions): Effect.Effect<Page<Message>, PostelErrors>;
  };
}

export type PostelEffectInboundApi<S extends Record<string, InboundSource>> = {
  [K in keyof S]: {
    verify<TData = EventOf<S[K]>>(
      rawBody: ArrayBuffer | Uint8Array | string,
      headers: WebhookHeaders,
    ): Effect.Effect<ComposedVerifyResult<TData>, PostelErrors>;
  };
};

// Mirrors `WithOutbound` in `@postel/core`'s `postel.ts`, swapping every
// `Promise`-returning method for its `Effect`-returning counterpart.
export type PostelEffectWithOutbound<C extends PostelConfig> = C extends {
  readonly outbound: { readonly storage: Storage<infer TTx> };
}
  ? { outbound: PostelEffectOutboundApi<TTx, EventsOf<C["outbound"]>> }
  : C extends { readonly outbound: OutboundConfig }
    ? { outbound: PostelEffectOutboundApi }
    : object;

// Mirrors `WithInbound` in `@postel/core`'s `postel.ts`.
export type PostelEffectWithInbound<C extends PostelConfig> = C extends {
  readonly inbound: infer I;
}
  ? I extends Record<string, InboundSource>
    ? { inbound: PostelEffectInboundApi<I> }
    : object
  : object;

export type PostelEffectApi<C extends PostelConfig = PostelConfig> = PostelEffectWithOutbound<C> &
  PostelEffectWithInbound<C>;

function buildEffectApi<C extends PostelConfig>(instance: PostelInstance<C>): PostelEffectApi<C> {
  const raw = instance as unknown as {
    outbound?: OutboundApi;
    inbound?: InboundApi<Record<string, InboundSource>>;
  };

  const outboundApi = raw.outbound
    ? {
        outbound: {
          send: wrapPromise(raw.outbound.send, raw.outbound),
          replay: wrapPromise(raw.outbound.replay, raw.outbound),
          messages: {
            get: wrapPromise(raw.outbound.messages.get, raw.outbound.messages),
            attempts: wrapPromise(raw.outbound.messages.attempts, raw.outbound.messages),
            list: wrapPromise(raw.outbound.messages.list, raw.outbound.messages),
          },
        },
      }
    : {};

  const inboundApi = raw.inbound
    ? {
        inbound: Object.fromEntries(
          Object.entries(raw.inbound).map(([key, sourceApi]) => [
            key,
            { verify: wrapPromise(sourceApi.verify, sourceApi) },
          ]),
        ),
      }
    : {};

  return { ...outboundApi, ...inboundApi } as PostelEffectApi<C>;
}

/**
 * The `Context.Tag` identifying the Effect-wrapped Postel service. Since the
 * service's shape depends on the caller's `PostelConfig`, call this with the
 * same `C` used at both `PostelLive(config)` and the consuming `Effect.gen`
 * to keep the two sides' types aligned — the underlying tag key is stable
 * across calls, only the TypeScript-level view of it changes.
 */
export const PostelTag = <C extends PostelConfig = PostelConfig>(): Context.Tag<
  PostelEffectApi<C>,
  PostelEffectApi<C>
> => Context.GenericTag<PostelEffectApi<C>>("@postel/effect/Postel");

/**
 * Builds Postel as a first-class Effect `Layer`. Acquiring the layer
 * constructs the Postel instance and starts its outbound worker pool
 * (`instance.start()`); releasing the layer's `Scope` gracefully stops it
 * (`instance.stop()`) — so an Effect program never calls the Promise-based
 * lifecycle methods directly.
 */
export function PostelLive<const C extends PostelConfig>(
  config: C,
): Layer.Layer<PostelEffectApi<C>> {
  const acquire = Effect.promise<PostelInstance<C>>(async () => {
    const instance = Postel(config);
    await instance.start();
    return instance;
  });
  const scoped: Effect.Effect<PostelInstance<C>, never, Scope.Scope> = Effect.acquireRelease(
    acquire,
    (instance) => Effect.promise(() => instance.stop()),
  );
  const mapped: Effect.Effect<PostelEffectApi<C>, never, Scope.Scope> = Effect.map(
    scoped,
    (instance): PostelEffectApi<C> => buildEffectApi<C>(instance),
  );
  return Layer.scoped(PostelTag<C>(), mapped);
}
