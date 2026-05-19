## RENAMED Requirements

- FROM: `### Requirement: createPostel factory returns the library instance`
- TO: `### Requirement: Postel factory returns the library instance`

## MODIFIED Requirements

### Requirement: Postel factory returns the library instance

The TypeScript port SHALL expose `Postel({ db, ...opts })` returning a fully-typed instance carrying `send`, `verify`, `start`, `endpoints`, `keys`, `tenants`, `replay`, `reconcile`, `dedup`, `jwksHandler`, `health`, and `on`. The factory identifier is the PascalCase `Postel` — a callable function, not a class; adopters do not use `new`. This capability spec describes the TypeScript port — one of several first-class language ports per [ADR 0005 — Polyglot staged rollout](../../../decisions/0005-polyglot-staged-rollout.md). Other ports' API surfaces are defined under their own `api-surface-<lang>` capabilities and conform to the same compliance contract.

#### Scenario: Type inference

- **WHEN** a TypeScript caller writes `const postel = Postel({ db })`
- **THEN** the result's methods are fully typed without explicit type parameters
