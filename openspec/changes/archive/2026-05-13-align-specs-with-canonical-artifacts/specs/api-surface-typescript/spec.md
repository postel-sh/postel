# api-surface-typescript — delta spec

## MODIFIED Requirements

### Requirement: createPostel factory returns the library instance

The TypeScript port SHALL expose `createPostel({ db, ...opts })` returning a fully-typed instance carrying `send`, `verify`, `start`, `endpoints`, `keys`, `tenants`, `replay`, `reconcile`, `dedup`, `jwksHandler`, `health`, and `on`. This capability spec describes the TypeScript port — one of several first-class language ports per [ADR 0005 — Polyglot staged rollout](../../../decisions/0005-polyglot-staged-rollout.md). Other ports' API surfaces are defined under their own `api-surface-<lang>` capabilities and conform to the same compliance contract.

#### Scenario: Type inference

- **WHEN** a TypeScript caller writes `const postel = createPostel({ db })`
- **THEN** the result's methods are fully typed without explicit type parameters
