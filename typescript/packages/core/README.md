# @postel/core

> Sender, receiver, types, and errors — the Postel TypeScript core.

This package is part of [Postel](https://github.com/postel-sh/postel), a polyglot webhooks library backed by solid, executable specs. The TypeScript implementation ships first; Go, Python, and Rust follow. Every port conforms to the same wire format, DB schema, and capability behaviors — verified by the `@postel/compliance` test suite.

## Status

**0.0.0 — receiver only.** This package currently exposes the receiver-side API through the `Postel({...})` factory plus stateless utilities, errors, and types. The sender (`send`), worker (`start`), endpoint / key / tenant / replay / reconciliation APIs, and the `db` storage option land in **v0.2.0+** along with `@postel/storage-*` adapters. See the [receiver capability spec](../../../openspec/specs/receiver/spec.md) and the [api-surface-typescript spec](../../../openspec/specs/api-surface-typescript/spec.md) for the contract.

Under the hood the receiver is implemented in [`@postel/edge`](../edge/README.md) — the same Web-Crypto code, inlined into `@postel/core` at build time, so installing `@postel/core` does not transitively install `@postel/edge`.

## Usage

```ts
import { Postel } from "@postel/core";

const postel = Postel();

const result = await postel.verify(rawBody, headers, process.env.WEBHOOK_SECRET!);
console.log(result.event.type);
```

`Postel({...})` is a callable function, not a class — adopters do not use `new`. The returned instance carries `verify`, `dedup`, and `jwksHandler` today. Adding `send`, `start`, `endpoints`, `keys`, `tenants`, `replay`, `reconcile`, `health`, and `on` is a pre-1.0 breaking-allowed change per ADR 0012 and the dist-packaging spec's 0.x clause.

Errors, the `PostelError` base, and the receiver type aliases (`WebhookEvent`, `VerifyResult`, `Keyset`, …) are reachable as named exports for `instanceof` checks and type imports. The construction helpers `createKeyset`, `inMemoryDedupAdapter`, and `signFixture` are also named exports — they are stateless builders / test helpers, not factory methods.

For edge-runtime receivers (Cloudflare Workers, Vercel Edge, Deno Deploy) where bundle size matters, use [`@postel/edge`](../edge/README.md) directly instead of `@postel/core`.

## License

MIT
