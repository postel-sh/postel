## MODIFIED Requirements

### Requirement: Postel factory returns the library instance

The TypeScript port SHALL expose `Postel({ observability?, outbound?, inbound? })` returning a fully-typed instance whose shape is conditional on which slots are configured:

- **Lifecycle methods are always present**: `postel.start()`, `postel.stop()`, `postel.health()`.
- **`postel.outbound`** is present iff the `outbound` config slot is provided. It carries `send`, `endpoints.{create,update,delete,list,get,disable,rotateSecret}`, `keys.{generateSymmetric,generateAsymmetric}`, `tenants.{setRateLimit,delete}`, `replay`, `reconcile`.
- **`postel.inbound`** is present iff the `inbound` config slot is provided. For each configured source key `K`, `postel.inbound[K]` exposes `verify` and (if a dedup adapter is configured for that source) `dedup`.

The factory identifier is the PascalCase `Postel` — a callable function, not a class; adopters do not use `new`. This capability spec describes the TypeScript port — one of several first-class language ports per [ADR 0005 — Polyglot staged rollout](../../../decisions/0005-polyglot-staged-rollout.md). Other ports' API surfaces are defined under their own `api-surface-<lang>` capabilities and conform to the same compliance contract.

#### Scenario: Type inference for the outbound surface

- **WHEN** a TypeScript caller writes `const postel = Postel({ outbound: { storage: DrizzleStorage(db) } })`
- **THEN** `postel.outbound.send(...)` is typed without explicit type parameters
- **AND** `postel.inbound` does not exist on the instance type

#### Scenario: Type inference for the inbound surface

- **WHEN** a TypeScript caller writes `const postel = Postel({ inbound: { github: { verify: Secret(s) } } })`
- **THEN** `postel.inbound.github.verify(body, headers)` is typed with the source key narrowed to `'github'`
- **AND** `postel.outbound` does not exist on the instance type

### Requirement: Conditional optionality of outbound and inbound

The shape of the instance returned by `Postel({...})` SHALL be conditional on which sub-namespace slots were configured. When `outbound` is omitted from the config object, `postel.outbound` MUST NOT exist on the instance type — not merely be `undefined` at runtime. The same applies to `inbound`. TypeScript MUST report a type error if the caller references a sub-namespace they did not configure. Receivers and senders are independent capabilities; a receiver-only consumer SHALL be able to construct `Postel({ inbound: {...} })` without touching any storage adapter or outbound configuration, and vice versa.

#### Scenario: Inbound-only consumer

- **WHEN** a consumer writes `const postel = Postel({ inbound: { github: { verify: Secret(s) } } })`
- **THEN** `postel.outbound` is a TypeScript error (the property is not on the instance type)
- **AND** `postel.inbound.github.verify(body, headers)` type-checks

#### Scenario: Outbound-only consumer

- **WHEN** a consumer writes `const postel = Postel({ outbound: { storage: DrizzleStorage(db) } })`
- **THEN** `postel.inbound` is a TypeScript error (the property is not on the instance type)
- **AND** `postel.outbound.send({ type, data })` type-checks

#### Scenario: Both configured

- **WHEN** a consumer configures both `outbound` and `inbound`
- **THEN** both `postel.outbound` and `postel.inbound` exist on the instance type
- **AND** lifecycle methods (`postel.start`, `postel.stop`, `postel.health`) are present regardless
