## Why

`@postel/core` exports the same in-memory dedup factory under two public names: `InMemoryDedup` (strategies, matching the `Secret` / `PublicKey` / `Keyset` / `FixedRate` factory style) and `inMemoryDedupAdapter` (a plain-function alias it delegates to). It also exports a marginal top-level `dedup(messageId, { ttl, adapter })` sugar even though the real, spec-backed API is the source-scoped `postel.inbound.<source>.dedup(messageId, options?)`. Duplicate names for one function bloat the contract surface right before the M3 contract freeze (#88) — kept past 0.x they become breaking to remove.

## What Changes

- **BREAKING (pre-1.0 surface trim)**: `inMemoryDedupAdapter` is removed from the `@postel/core` public surface. `InMemoryDedup(options?)` is the single public in-memory dedup factory; `InMemoryDedupOptions` stays exported.
- **BREAKING (pre-1.0 surface trim)**: the top-level `dedup(messageId, { ttl, adapter })` helper is removed from the `@postel/core` public surface. The idempotency dedup helper is the source-scoped `postel.inbound.<source>.dedup(messageId, { ttl?, tx? })`, unchanged behaviorally (first receipt / duplicate / concurrent race semantics stay identical).
- The `receiver` spec's *Idempotency dedup helper* requirement is reworded to name the source-scoped API unambiguously (it currently says `postel.dedup(messageId, { ttl })`).
- The `distribution-packaging-typescript` package inventory names `InMemoryDedup` instead of `inMemoryDedupAdapter` as core's in-memory dedup export.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `receiver`: MODIFY *Idempotency dedup helper* — the helper is specified as `postel.inbound.<source>.dedup(messageId, { ttl })` (source-scoped), not a top-level `postel.dedup`; atomicity, TTL, and adapter requirements are unchanged.
- `distribution-packaging-typescript`: MODIFY *Published package map* — `@postel/core`'s in-memory dedup export is `InMemoryDedup` (was `inMemoryDedupAdapter`).

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: unchanged.

## Impact

- `typescript/packages/core/src/{dedup.ts,strategies/dedup.ts,index.ts}` — implementation moves into `strategies/dedup.ts`; `dedup` and `inMemoryDedupAdapter` leave `src/index.ts`.
- Internal consumers migrate: `typescript/packages/core/test/dedup.test.ts`, `typescript/packages/http/test/dedup-ack.test.ts`, `typescript/packages/storage/{pg,sqlite,mysql}/test/dedup.test.ts`, `typescript/scripts/reference-receiver.mjs`.
- Docs already teach `InMemoryDedup` + `postel.inbound.<source>.dedup`; no adopter-facing snippet changes expected beyond a sweep.
- No cross-port contract change beyond naming: the `DedupAdapter` interface and dedup semantics are untouched; ports name their own factories.
