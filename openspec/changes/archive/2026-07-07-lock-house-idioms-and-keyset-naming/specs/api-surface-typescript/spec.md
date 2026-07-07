## MODIFIED Requirements

### Requirement: All writes accept an optional transaction parameter

Every TS write API (e.g., `outbound.send`, `outbound.endpoints.create`, `outbound.endpoints.update`, `outbound.tenants.delete`, `inbound.<source>.dedup`) SHALL accept an optional `tx` (transaction) parameter so the operation can participate in a host transaction. The parameter name is `tx` everywhere; the value type is whatever transaction handle the configured storage adapter accepts.

`tx` SHALL ride in the method's options bag — the same object that carries the operation's other options — never as a separate trailing runtime argument. Concretely: `outbound.endpoints.create({ url, ..., tx })` and `outbound.endpoints.update(id, { url, ..., tx })` take `tx` alongside the endpoint fields, exactly as `send(event, { tx })`, `endpoints.delete(id, { purgeAttempts, tx })`, `endpoints.rotateSecret(id, { keepPreviousFor, tx })`, and `inbound.<source>.dedup(messageId, { ttl, tx })` already do. A write method SHALL NOT expose two option-carrying parameters.

#### Scenario: Transactional create

- **WHEN** the host wraps `outbound.endpoints.create({ url, ..., tx })` in its transaction
- **THEN** the row is committed/rolled back together with the host's transaction
- **AND** no trailing runtime argument exists on `create` / `update` — `tx` is a key in the single options bag

#### Scenario: Inbound dedup inside a transaction

- **WHEN** the host calls `inbound.github.dedup(messageId, { ttl: '1h', tx })` inside a transaction that also performs business writes
- **THEN** the dedup record commits or rolls back atomically with the business writes

## ADDED Requirements

### Requirement: House API idioms [PORT-SPECIFIC]

The TypeScript surface SHALL use exactly one idiom for each recurring API concern, per [ADR 0015 — House API idioms](../../../decisions/0015-house-api-idioms.md):

- **Durations** are `number | string` everywhere a duration is configured: an integer number of seconds, or a duration string in the `"<integer><s|m|h|d>"` grammar shared with `dedupTtl` (e.g. `"5m"`). `InboundSource.tolerance` SHALL accept both forms.
- **Time injection** is `clock?: Clock` (`{ now(): Date; sleep(ms): Promise<void> }`), the shape already used by `OutboundConfig.clock`. `InboundSource` and `VerifyOptions` SHALL accept `clock`; no public option SHALL take a bare `now?: () => Date` function.
- **Transactions** ride in the options bag — owned by *All writes accept an optional transaction parameter*.
- **Collision-free exports**: every public name SHALL be exported from the package root under its source name. The root SHALL contain no `as`-renamed re-exports; when two source names collide, the losing declaration is renamed at source (`SecretValue` for the secret string alias vs the `Secret()` verifier factory; `JwksKeyset` / `createJwksKeyset` / `SecretOrJwksKeyset` for the keyset object vs the `Keyset()` verifier factory; a single `MessageId` alias shared by the outbound and storage surfaces).

**Conformance**: PORT-SPECIFIC. The concrete TypeScript spellings (`number | string` unions, the `Clock` interface, ES-module export mechanics) are this port's idioms; other ports mirror the *rule* — one idiom per concern, durations accept both integer seconds and the shared duration-string grammar, time is injected through one clock abstraction, and public names never collide — through their own language idioms. The behaviors these idioms configure (timestamp-window enforcement, dedup TTLs, deterministic verification) remain CONTRACT under `receiver` and `sender`.

#### Scenario: Duration strings are accepted wherever seconds are

- **WHEN** an inbound source configures `tolerance: "10m"` and a request arrives with a `webhook-timestamp` nine minutes old
- **THEN** verification succeeds, identically to `tolerance: 600`

#### Scenario: Clock is the single time-injection idiom

- **WHEN** a caller passes `clock` (an object with `now()` returning a fixed `Date`) to an inbound source or to standalone `verify(..., { clock })`
- **THEN** the timestamp window is evaluated against `clock.now()` rather than wall time

#### Scenario: Package root has no renamed re-exports

- **WHEN** the `@postel/core` root export surface is inspected
- **THEN** it contains no `as`-renamed re-export; `SecretValue`, `JwksKeyset`, `SecretOrJwksKeyset`, `createJwksKeyset`, `MessageId`, and `Unsubscribe` are exported under their source names alongside the `Secret()` / `Keyset()` verifier factories
