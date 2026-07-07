# Lock house API idioms and disambiguate the keyset naming triad

## Why

The public TypeScript surface has drifted into competing idioms — a trailing runtime `{ tx }` argument next to options-bag `tx`, seconds-only `tolerance` next to `number | string` durations everywhere else, two time-injection shapes (`now?: () => Date` vs `clock?: Clock`), and four `as`-renamed re-exports papering over source-name collisions (including three keyset-named things a reader cannot tell apart). M3 is the contract freeze; the ports copy whatever ships, so each idiom must be locked to exactly one form now (#86, #87).

## What Changes

- **BREAKING** `outbound.endpoints.create(opts)` / `update(id, opts)` lose their trailing `runtime?: { tx }` argument; `tx` rides in the options bag (`create({ url, ..., tx })`), matching `send`, `rotateSecret`, `delete`, and every other write.
- `InboundSource.tolerance` widens from `number` to `number | string` (duration strings like `"5m"`, converted via the same parser as `dedupTtl`).
- **BREAKING** `InboundSource.now?: () => Date` and `VerifyOptions.now?: () => Date` are replaced by `clock?: Clock` — the one time-injection idiom, matching `OutboundConfig.clock`.
- **BREAKING** export collisions are renamed at source so no `as`-renamed re-export remains in the `@postel/core` root:
  - type `Secret` (string alias) → `SecretValue`; the `Secret()` verifier factory keeps the name.
  - type `Keyset` → `JwksKeyset` and `createKeyset()` → `createJwksKeyset()`; the `Keyset()` verifier factory keeps the name. `SecretOrKeyset` → `SecretOrJwksKeyset` for consistency.
  - outbound `MessageId` now re-uses the storage `MessageId` alias (one definition, exported once).
  - storage `Unsubscribe` is exported under its source name (nothing else claims it).
- New ADR records the four locked idioms for the Go / Python / Rust ports to mirror.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- **`api-surface-typescript`** — MODIFY *All writes accept an optional transaction parameter* (tx always rides in the options bag; no trailing runtime argument). ADD *House API idioms: durations, clock injection, collision-free exports*.
- **`receiver`** — MODIFY *JWKS consumer* (`createKeyset` → `createJwksKeyset`). MODIFY *Timestamp window enforcement* (the window is configurable as seconds or a duration string; deterministic time comes from an injected clock).

## Wire-format / DB-schema impact

Wire-format: unchanged (naming and config-shape only; no header, signature, or envelope change). DB-schema: unchanged.

## Impact

- `@postel/core`: `types.ts` (`SecretValue`, `JwksKeyset`, `SecretOrJwksKeyset`, `VerifyOptions.clock`), `keyset.ts` (`createJwksKeyset`), `inbound.ts` (`tolerance: number | string`, `clock`), `outbound.ts` + `sender/endpoint/crud.ts` (merged tx bag, shared `MessageId`), `index.ts` (no `as`-renamed re-exports), `ttl.ts` (error text no longer dedup-specific).
- Tests across core, frameworks (express/fastify/hono/nestjs), and http swap `now:` fixtures for `clock:` and adopt the renamed exports.
- Docs: `inbound/verify.mdx` configuration shape (tolerance durations, `clock`). The `Keyset({ jwksUri })` factory snippets across docs and the landing page are unchanged — the factory keeps its name.
- Issues closed: #86, #87.
