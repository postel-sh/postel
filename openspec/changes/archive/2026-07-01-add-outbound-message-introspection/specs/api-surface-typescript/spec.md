## MODIFIED Requirements

### Requirement: Postel factory returns the library instance

The TypeScript port SHALL expose `Postel({ observability?, outbound?, inbound? })` returning a fully-typed instance whose shape is conditional on which slots are configured:

- **Lifecycle methods are always present**: `postel.start()`, `postel.stop()`, `postel.health()`.
- **`postel.outbound`** is present iff the `outbound` config slot is provided. It carries `send`, `endpoints.{create,update,delete,list,get,disable,rotateSecret}`, `keys.{generateSymmetric,generateAsymmetric}`, `tenants.{setRateLimit,delete}`, `replay`, `reconcile`, and the read/introspection surface `messages.{get,attempts,list}`.
- **`postel.inbound`** is present iff the `inbound` config slot is provided. For each configured source key `K`, `postel.inbound[K]` exposes `verify` and (if a dedup adapter is configured for that source) `dedup`.

The factory identifier is the PascalCase `Postel` — a callable function, not a class; adopters do not use `new`. This capability spec describes the TypeScript port — one of several first-class language ports per [ADR 0005 — Polyglot staged rollout](../../../decisions/0005-polyglot-staged-rollout.md). Other ports' API surfaces are defined under their own `api-surface-<lang>` capabilities and conform to the same compliance contract.

The `messages.{get,attempts,list}` read surface is the TypeScript projection of the `message-introspection` capability; its read OUTCOME (a message and its attempt history are retrievable) is the cross-port CONTRACT, while these method names are the port mechanism.

#### Scenario: Type inference for the outbound surface

- **WHEN** a TypeScript caller writes `const postel = Postel({ outbound: { storage: DrizzleStorage(db) } })`
- **THEN** `postel.outbound.send(...)` is typed without explicit type parameters
- **AND** `postel.inbound` does not exist on the instance type

#### Scenario: Type inference for the inbound surface

- **WHEN** a TypeScript caller writes `const postel = Postel({ inbound: { github: { verify: Secret(s) } } })`
- **THEN** `postel.inbound.github.verify(body, headers)` is typed with the source key narrowed to `'github'`
- **AND** `postel.outbound` does not exist on the instance type

#### Scenario: Outbound read surface is present

- **WHEN** a TypeScript caller configures `outbound` and calls `postel.outbound.messages.get(id)`
- **THEN** the call is well-typed and returns the message (or an absent result)
- **AND** `postel.outbound.messages.attempts(id)` and `postel.outbound.messages.list(...)` are present on the instance type
