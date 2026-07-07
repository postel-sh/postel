# 0016 — House API idioms

- **Status**: Accepted
- **Date**: 2026-07-07
- **Decision drivers**: M3 contract freeze, cross-port consistency (the Go / Python / Rust ports copy what the TypeScript surface ships), one-way-to-do-it API ergonomics

## Context

The TypeScript surface grew capability by capability, and by M3 it carried several concerns with two competing spellings each:

- `outbound.endpoints.create(opts, runtime?: { tx })` and `update(id, opts, runtime?)` took a trailing runtime argument, while `send(event, { tx })`, `endpoints.delete(id, { purgeAttempts, tx })`, `rotateSecret(id, { keepPreviousFor, tx })`, and `dedup(messageId, { ttl, tx })` carried `tx` in the options bag.
- `InboundSource.tolerance` was seconds-only, while `dedupTtl`, retry schedules, and `keepPreviousFor` accepted `number | string` durations (`"5m"`).
- Time injection had two shapes: `InboundSource.now?: () => Date` / `VerifyOptions.now?: () => Date` on the receive side, `OutboundConfig.clock?: Clock` on the send side.
- Four `as`-renamed re-exports in the `@postel/core` root (`Secret as RawSecret`, `Keyset as JwksKeyset`, `MessageId as StorageMessageId`, `Unsubscribe as StorageUnsubscribe`) papered over source-name collisions instead of resolving them — including a keyset triad (`Keyset()` verifier factory, `createKeyset()` constructor, `Keyset` type) whose members a reader could not tell apart.

Every port that follows would have inherited the drift. M3 is the freeze window: break it now, once, or contract the inconsistency forever (#86, #87).

## Decision

Lock exactly one idiom per concern. Ports MUST mirror the rule (through their own language idioms), not necessarily the TypeScript spelling.

1. **Transactions ride in the options bag.** Every write takes a single trailing options object, and `tx` is a key in it: `endpoints.create({ url, ..., tx })`, `endpoints.update(id, { ...patch, tx })`. No write method exposes a separate runtime argument alongside an options bag.

2. **Durations are `number | string` everywhere.** Any duration-valued option accepts an integer number of seconds or a duration string in the shared `"<integer><s|m|h|d>"` grammar (`"5m"`, `"24h"`), parsed by one parser (`ttlToSeconds`). No duration option is seconds-only.

3. **Time injection is `Clock`.** The single time-injection shape is `clock?: Clock` (`{ now(): Date; sleep(ms): Promise<void> }`), on `OutboundConfig`, `InboundSource`, and `VerifyOptions` alike. No public option takes a bare `now?: () => Date`.

4. **No source-name collisions, no renamed re-exports.** Every public name is exported from the package root under its source name. When two declarations want the same name, the losing one is renamed at its source — the root never patches a collision with `export { X as Y }`. Applied at freeze time:
   - The `Secret()` verifier factory keeps the name; the secret string alias is `SecretValue`.
   - The `Keyset()` verifier factory keeps the name (it sits alongside `Secret` / `PublicKey` / `Noop`); the keyset object type is `JwksKeyset`, its constructor is `createJwksKeyset()`, and the verify-input union is `SecretOrJwksKeyset` — each return type guessable from the name.
   - `MessageId` has a single definition (the storage alias), shared by the outbound surface.
   - Storage's `Unsubscribe` is exported under its own name (nothing else claims it).

## Consequences

- **BREAKING** for pre-freeze TypeScript adopters: `endpoints.create` / `update` drop the trailing runtime argument; `createKeyset`, `Keyset` (type), `SecretOrKeyset`, `Secret` (type), and `now` options are renamed or reshaped. Accepted deliberately inside the M3 freeze — after 1.0 each of these would be a majorable break.
- New surface MUST conform: a PR adding a seconds-only duration, a `now` callback, a second options-carrying parameter, or an `as`-renamed root re-export is wrong by construction.
- Ports start from these idioms at birth. The spec-level statement lives in `api-surface-typescript` (*House API idioms*, *All writes accept an optional transaction parameter*) and `receiver` (*Timestamp window enforcement*, *JWKS consumer*).
