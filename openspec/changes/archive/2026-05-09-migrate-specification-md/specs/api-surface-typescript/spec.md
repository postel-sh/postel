# API surface (TypeScript) — delta spec

## ADDED Requirements

### Requirement: createPostel factory returns the library instance

The TypeScript reference implementation SHALL expose `createPostel({ db, ...opts })` returning a fully-typed instance carrying `send`, `verify`, `start`, `endpoints`, `keys`, `tenants`, `replay`, `reconcile`, `dedup`, `jwksHandler`, `health`, and `on`.

#### Scenario: Type inference

- **WHEN** a TypeScript caller writes `const postel = createPostel({ db })`
- **THEN** the result's methods are fully typed without explicit type parameters

### Requirement: Public function signatures match Standard Webhooks event shape

The TS API SHALL accept and produce events shaped as `{ type, timestamp, data, channels?, version? }`. Type definitions MUST flow through to consumers without `any`.

#### Scenario: Strongly-typed event

- **WHEN** a consumer calls `postel.send<OrderCreated>({ type: 'order.created', data: {...} })`
- **THEN** TypeScript infers the `data` shape from the `OrderCreated` generic

### Requirement: Structured error classes

Every public failure mode SHALL throw a typed error class derived from `PostelError`. Error subclasses MUST cover at least: `SignatureInvalid`, `TimestampTooOld`, `MalformedHeader`, `UnknownKeyId`, `RawBytesMismatchDetected`, `EndpointDisabled`, `IdempotencyKeyConflict`, `MigrationRequired`. Consumers MUST be able to discriminate via `instanceof`.

#### Scenario: instanceof discrimination

- **WHEN** a consumer wraps `verify(...)` in try/catch and inspects the error
- **THEN** `err instanceof SignatureInvalid` correctly identifies signature failures

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
