# @postel/effect

> A first-class Effect-TS layer over [`@postel/core`](../core).

## Why a layer, not a callback

Per [ADR-backed `api-surface-typescript`](../../../openspec/specs/api-surface-typescript/spec.md)'s `Effect-TS layer` requirement, `@postel/effect` isn't a thin `Effect.promise` wrapper bolted onto the Promise API — it's a `Layer` that Effect-manages the Postel instance's lifecycle end to end: acquiring it starts the outbound worker pool, and releasing its `Scope` stops it.

## Usage

```ts
import { PostelLive, PostelTag } from "@postel/effect";
import { InMemoryStorage, Secret } from "@postel/core";
import { Effect } from "effect";

const config = {
  outbound: { storage: InMemoryStorage() },
  inbound: { github: { verify: Secret(process.env.GITHUB_WEBHOOK_SECRET!) } },
} as const;

const Postel = PostelTag<typeof config>();

const program = Effect.gen(function* () {
  const postel = yield* Postel;
  const { id } = yield* postel.outbound.send({ type: "order.created", data: { id: "o_1" } });
  return id;
});

await Effect.runPromise(program.pipe(Effect.provide(PostelLive(config))));
```

`postel.outbound.send`, `postel.outbound.replay`, `postel.outbound.messages.{get,attempts,list}`, and each configured source's `postel.inbound.<source>.verify` return `Effect`s failing with `PostelErrors` (`PostelError | ConfigurationError | NotImplementedError`) — catchable via `Effect.catchTag`/`Effect.catchAll` — instead of Promises that reject.

See the [docs](https://postel.dev/docs/reference/effect) for the full guide.

## License

MIT
