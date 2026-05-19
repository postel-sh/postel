# api-surface-typescript Specification

## Purpose

The TypeScript-port public API surface — the `Postel` factory, typed event-shape generics, structured `PostelError` class hierarchy, Effect-TS adapter, and the convention that every write accepts an optional transaction handle (host-transaction passthrough). One port among the planned polyglot set per [ADR 0005](../../../decisions/0005-polyglot-staged-rollout.md); future language ports follow the same compliance contract under their own `api-surface-<lang>` capabilities.
## Requirements
### Requirement: Postel factory returns the library instance

The TypeScript port SHALL expose `Postel({ db, ...opts })` returning a fully-typed instance carrying `send`, `verify`, `start`, `endpoints`, `keys`, `tenants`, `replay`, `reconcile`, `dedup`, `jwksHandler`, `health`, and `on`. The factory identifier is the PascalCase `Postel` — a callable function, not a class; adopters do not use `new`. This capability spec describes the TypeScript port — one of several first-class language ports per [ADR 0005 — Polyglot staged rollout](../../../decisions/0005-polyglot-staged-rollout.md). Other ports' API surfaces are defined under their own `api-surface-<lang>` capabilities and conform to the same compliance contract.

#### Scenario: Type inference

- **WHEN** a TypeScript caller writes `const postel = Postel({ db })`
- **THEN** the result's methods are fully typed without explicit type parameters

### Requirement: Public function signatures match Standard Webhooks event shape

The TS API SHALL accept and produce events shaped as `{ type, timestamp, data, channels?, version? }`. Type definitions MUST flow through to consumers without `any`.

#### Scenario: Strongly-typed event

- **WHEN** a consumer calls `postel.send<OrderCreated>({ type: 'order.created', data: {...} })`
- **THEN** TypeScript infers the `data` shape from the `OrderCreated` generic

### Requirement: Structured error classes

Every public failure mode SHALL throw a typed error class derived from `PostelError`. Each subclass MUST have:

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

Every TS write API (e.g., `send`, `endpoints.create`, `endpoints.update`, `tenants.delete`) SHALL accept an optional `db` (transaction) parameter so the operation can participate in a host transaction.

#### Scenario: Transactional create

- **WHEN** the host wraps `endpoints.create({...}, { db: tx })` in its transaction
- **THEN** the row is committed/rolled back together with the host's transaction

