# api-surface-typescript Specification

## Purpose

The TypeScript-port public API surface — the `Postel` factory, typed event-shape generics, structured `PostelError` class hierarchy, Effect-TS adapter, and the convention that every write accepts an optional transaction handle (host-transaction passthrough). One port among the planned polyglot set per [ADR 0005](../../../decisions/0005-polyglot-staged-rollout.md); future language ports follow the same compliance contract under their own `api-surface-<lang>` capabilities.
## Requirements
### Requirement: Postel factory returns the library instance

The TypeScript port SHALL expose `Postel({ observability?, outbound?, inbound? })` returning a fully-typed instance whose shape is conditional on which slots are configured:

- **Lifecycle methods are always present**: `postel.start()`, `postel.stop()`, `postel.health()`.
- **`postel.outbound`** is present iff the `outbound` config slot is provided. It carries `send`, `endpoints.{create,update,delete,list,get,disable,rotateSecret}`, `keys.{generateSymmetric,generateAsymmetric}`, `tenants.{setRateLimit,delete}`, `replay`, `reconcile`.
- **`postel.inbound`** is present iff the `inbound` config slot is provided. For each configured source key `K`, `postel.inbound[K]` exposes `verify` and (if a dedup adapter is configured for that source) `dedup`.

The factory identifier is the PascalCase `Postel` — a callable function, not a class; adopters do not use `new`. This capability spec describes the TypeScript port — one of several first-class language ports per [ADR 0005 — Polyglot staged rollout](../../../decisions/0005-polyglot-staged-rollout.md). Other ports' API surfaces are defined under their own `api-surface-<lang>` capabilities and conform to the same compliance contract.

#### Scenario: Type inference for the outbound surface

- **WHEN** a TypeScript caller writes `const postel = Postel({ outbound: { storage: postelDrizzle(db) } })`
- **THEN** `postel.outbound.send(...)` is typed without explicit type parameters
- **AND** `postel.inbound` does not exist on the instance type

#### Scenario: Type inference for the inbound surface

- **WHEN** a TypeScript caller writes `const postel = Postel({ inbound: { github: { verify: Secret(s) } } })`
- **THEN** `postel.inbound.github.verify(body, headers)` is typed with the source key narrowed to `'github'`
- **AND** `postel.outbound` does not exist on the instance type

### Requirement: Public function signatures match Standard Webhooks event shape

The TS API SHALL accept and produce events shaped as `{ type, timestamp?, data?, channels?, version? }`. Only `type` is required; `timestamp`, `data`, `channels`, and `version` are optional. Standard Webhooks carries the canonical message timestamp on the `webhook-timestamp` HTTP header — an event body MAY include a `timestamp` field as a host-side convention but is not required to. `data` is optional for events with no payload (e.g., a `user.deleted` event where the receiver identifies the user from headers or message id alone). Type definitions MUST flow through to consumers without `any`.

#### Scenario: Strongly-typed event

- **WHEN** a consumer calls `postel.outbound.send<OrderCreated>({ type: 'order.created', data: {...} })`
- **THEN** TypeScript infers the `data` shape from the `OrderCreated` generic

#### Scenario: Event with only the required `type` field

- **WHEN** a consumer calls `postel.outbound.send({ type: 'user.deleted' })` with no `data`, `timestamp`, `channels`, or `version`
- **THEN** the call is well-typed and accepted; no field beyond `type` is mandated by the library's public types

### Requirement: Structured error classes

Every public failure mode representing a **webhook-protocol or wire-format outcome** SHALL throw a typed error class derived from `PostelError`. Each `PostelError` subclass MUST have:

- A **PascalCase class name** (TypeScript-idiomatic).
- A stable **`code` property** in SCREAMING_SNAKE_CASE that matches the corresponding error code documented in `receiver` (so the codes are consumable from contexts that don't have access to the class hierarchy — e.g., admin handler JSON payloads, cross-port port API audits, log correlation).
- Discoverable via `instanceof` AND via `err.code === 'X'` checks.

The canonical class ↔ code mapping is:

| Class | `.code` |
|---|---|
| `SignatureInvalid` | `SIGNATURE_INVALID` |
| `TimestampTooOld` | `TIMESTAMP_TOO_OLD` |
| `MalformedHeader` | `MALFORMED_HEADER` |
| `UnknownKeyId` | `UNKNOWN_KEY_ID` |
| `RawBytesMismatchDetected` | `RAW_BYTES_MISMATCH_DETECTED` |
| `EndpointDisabled` | `ENDPOINT_DISABLED` |
| `IdempotencyKeyConflict` | `IDEMPOTENCY_KEY_CONFLICT` |
| `MigrationRequired` | `MIGRATION_REQUIRED` |
| `EndpointValidation` | `ENDPOINT_VALIDATION` |
| `SsrfBlocked` | `SSRF_BLOCKED` |

Adding a new error class MUST add both names atomically. The `receiver` capability's error-code list and this table are synchronized — drift between the two is treated as a bug.

**Implementation-state errors are intentionally outside the `PostelError` hierarchy.** Errors that describe library state rather than webhook semantics — e.g., `NotImplementedError`, thrown when a port version exposes a typed method whose runtime has not yet shipped — describe a *different category* of failure than webhook-protocol outcomes. Adopters who write the natural pattern `if (err instanceof PostelError) return 4xx` are translating webhook-protocol failures into HTTP responses; that pattern MUST NOT accidentally catch implementation-state errors and convert them into HTTP 4xx, because library-state failures are programming/version errors that should bubble as 5xx (or fail-fast in development). Implementation-state errors SHALL therefore extend the platform `Error` class directly and SHALL carry a stable `code` property (e.g., `code: 'NOT_IMPLEMENTED'`) for adopters who explicitly want to discriminate them, but they SHALL NOT extend `PostelError` and their codes SHALL NOT appear in the `PostelErrorCode` union.

#### Scenario: instanceof discrimination

- **WHEN** a consumer wraps `verify(...)` in try/catch and inspects the error
- **THEN** `err instanceof SignatureInvalid` correctly identifies signature failures

#### Scenario: code property discrimination

- **WHEN** a consumer reads `err.code` on a thrown error of class `SignatureInvalid`
- **THEN** the value is the stable string `'SIGNATURE_INVALID'`

#### Scenario: Cross-port code parity

- **WHEN** the equivalent Go / Python / Rust port produces an error for the same failure mode
- **THEN** the error carries the same SCREAMING_SNAKE code (`'SIGNATURE_INVALID'`)
- **AND** consumers can match on `code` across language boundaries via JSON payloads

#### Scenario: Implementation-state errors are not PostelError

- **WHEN** a consumer calls a typed method whose runtime has not yet landed in the current port version (e.g., `postel.outbound.send(...)` in `@postel/core` v0.x)
- **THEN** the call throws a `NotImplementedError`
- **AND** `err instanceof NotImplementedError` is true
- **AND** `err instanceof Error` is true
- **AND** `err instanceof PostelError` is **false**
- **AND** `err.code === 'NOT_IMPLEMENTED'` for explicit discrimination
- **AND** the typical adopter catch pattern `if (err instanceof PostelError) return 4xx` does NOT match, so the error bubbles as a programming/version issue rather than being misclassified as a webhook-protocol failure

### Requirement: No string matching on errors

Public error contracts SHALL be discriminated by class identity or a stable typed `code`/`name` property — never by message string.

#### Scenario: Stable code property

- **WHEN** a consumer reads `err.code` on a thrown `PostelError`
- **THEN** the value is a stable enum-like string documented in the API reference

### Requirement: Effect-TS layer

The library SHALL provide an Effect-TS adapter (`@postel/effect`) exposing every public API as an `Effect`. The adapter MUST be a first-class layer, not a callback-style afterthought.

#### Scenario: Effect program composes

- **WHEN** an Effect-TS user writes `pipe(postelEffect.send(...), Effect.flatMap(...))`
- **THEN** the program type-checks and runs without bridging utilities

### Requirement: All writes accept an optional transaction parameter

Every TS write API (e.g., `outbound.send`, `outbound.endpoints.create`, `outbound.endpoints.update`, `outbound.tenants.delete`, `inbound.<source>.dedup`) SHALL accept an optional `tx` (transaction) parameter so the operation can participate in a host transaction. The parameter name is `tx` everywhere; the value type is whatever transaction handle the configured storage adapter accepts.

#### Scenario: Transactional create

- **WHEN** the host wraps `outbound.endpoints.create({...}, { tx })` in its transaction
- **THEN** the row is committed/rolled back together with the host's transaction

#### Scenario: Inbound dedup inside a transaction

- **WHEN** the host calls `inbound.github.dedup(messageId, { ttl: '1h', tx })` inside a transaction that also performs business writes
- **THEN** the dedup record commits or rolls back atomically with the business writes

### Requirement: Verifier strategy composition

Inbound sources SHALL configure verification via a `Verifier` strategy or a `ReadonlyArray<Verifier>`. The library MUST provide at least three Verifier factory functions:

- `Secret(s: string)` — HMAC v1 with a single shared secret.
- `PublicKey(pk: string)` — Ed25519 v1a with a static public key.
- `Keyset(opts: { jwksUri, refreshEvery?, cacheTtl?, fetch? })` — Ed25519 v1a with JWKS-backed kid lookup.

When a source's `verify` slot is an array, verifiers SHALL be tried in order; the first match wins. The verify result MUST indicate which verifier matched via a `matchedVerifierIndex` field. Mixed-mode arrays (e.g., `[Secret(legacy), Keyset(newJwks)]`) MUST be supported so adopters can run cross-scheme migration windows. This generalizes the receiver capability's `Multi-secret window` requirement to cover any composition of `Verifier` strategies.

#### Scenario: HMAC rotation via verifier array

- **WHEN** a source configures `verify: [Secret(NEW), Secret(OLD)]` and a request arrives signed with `OLD`
- **THEN** verification succeeds
- **AND** the result's `matchedVerifierIndex` is `1`

#### Scenario: Cross-scheme migration

- **WHEN** a source configures `verify: [Secret(LEGACY_HMAC), Keyset({ jwksUri })]` and a request arrives signed with a v1a signature whose kid resolves in the keyset
- **THEN** verification succeeds against the Keyset
- **AND** the result's `matchedVerifierIndex` is `1`

#### Scenario: No verifier matches

- **WHEN** a source configures `verify: [Secret(a), Keyset({ jwksUri })]` and none of the verifiers match the incoming signature
- **THEN** `verify()` throws `SignatureInvalid`

#### Scenario: Single verifier is equivalent to a one-element array

- **WHEN** a source configures `verify: Secret(s)` (not wrapped in an array)
- **THEN** verification behaves identically to `verify: [Secret(s)]`
- **AND** the result's `matchedVerifierIndex` is `0` on success

### Requirement: Conditional optionality of outbound and inbound

The shape of the instance returned by `Postel({...})` SHALL be conditional on which sub-namespace slots were configured. When `outbound` is omitted from the config object, `postel.outbound` MUST NOT exist on the instance type — not merely be `undefined` at runtime. The same applies to `inbound`. TypeScript MUST report a type error if the caller references a sub-namespace they did not configure. Receivers and senders are independent capabilities; an edge-only consumer SHALL be able to construct `Postel({ inbound: {...} })` without touching any storage adapter or outbound configuration.

#### Scenario: Inbound-only consumer

- **WHEN** a consumer writes `const postel = Postel({ inbound: { github: { verify: Secret(s) } } })`
- **THEN** `postel.outbound` is a TypeScript error (the property is not on the instance type)
- **AND** `postel.inbound.github.verify(body, headers)` type-checks

#### Scenario: Outbound-only consumer

- **WHEN** a consumer writes `const postel = Postel({ outbound: { storage: postelDrizzle(db) } })`
- **THEN** `postel.inbound` is a TypeScript error (the property is not on the instance type)
- **AND** `postel.outbound.send({ type, data })` type-checks

#### Scenario: Both configured

- **WHEN** a consumer configures both `outbound` and `inbound`
- **THEN** both `postel.outbound` and `postel.inbound` exist on the instance type
- **AND** lifecycle methods (`postel.start`, `postel.stop`, `postel.health`) are present regardless

### Requirement: Outbound defaults are overridable per endpoint

The `outbound` config slot SHALL accept org-wide defaults for `signing`, `retryPolicy`, `circuitBreaker`, `autoDisable`, and `http`. Each `outbound.endpoints.create({...})` and `outbound.endpoints.update({...})` call SHALL accept the same option keys to override the org-wide default on a per-endpoint basis. The resolution order at dispatch time MUST be: per-endpoint value > org-wide default > library default. Storage adapter, KMS adapter, worker strategy, and retention policy are deployment-level and not overridable per endpoint.

#### Scenario: Per-endpoint retry override

- **WHEN** an org configures `outbound: { retryPolicy: ExponentialBackoff({...}) }` and a caller invokes `outbound.endpoints.create({ url, retryPolicy: LinearBackoff({...}) })`
- **THEN** the resulting endpoint uses the linear-backoff policy at dispatch time
- **AND** other endpoints with no per-endpoint override use the exponential default

#### Scenario: Per-endpoint TLS opt-out

- **WHEN** an org configures `outbound: { http: { tls: { verify: true } } }` and a caller invokes `outbound.endpoints.create({ url, http: { tls: { verify: false } } })`
- **THEN** dispatch attempts to that endpoint skip TLS verification
- **AND** the library emits a warning at creation time per the sender capability's `TLS verification by default` requirement

