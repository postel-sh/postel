# 0003 — Code-first configuration (no YAML, no DSL)

- **Status**: accepted
- **Date**: 2026-05-09
- **Decision drivers**: AR-2 (code-first config), DX, type safety, refactoring ergonomics

## Context

Many webhook tools accept declarative configuration: YAML files for endpoints, a CEL or JSONLogic-style expression language for filters, a templating language for transforms. The argument for declarative config is that ops can change behavior without redeploying code.

The argument against is type safety, refactoring, debugging, and the inevitable expressiveness gap that pushes users to write code anyway — but in a worse language with worse tooling.

## Decision

All policy in Postel is TypeScript code in the host's codebase: filters, transforms, retry policies, custom headers, admin auth predicates. There is no YAML, no DSL, no expression language.

Concretely:
- Filters are predicates: `(event) => boolean`.
- Transforms are pure functions: `(event) => bodyToSend`.
- Retry policies are objects: `{ schedule: ['1m', '5m', ...], jitter: 0.2, maxAttempts: 12 }`.
- Endpoint config lives in normal application code, not in a config file the library reads.

## Consequences

- Full TypeScript inference and type safety on every policy.
- Refactoring tools work (rename a field, every reference updates).
- Tests are normal unit tests, not "test the YAML parser" detours.
- Hot-reloading config requires a redeploy (or hot-reload of the host process).

## Alternatives considered

- **YAML config + escape-hatch JS** — rejected. The escape hatch becomes everyone's default, which means we maintain two configuration layers.
- **CEL or JSONLogic for filters** — rejected. Adds a runtime dependency, a learning curve, and bounded expressiveness.
- **Declarative endpoint registry (DB-backed only)** — partially adopted: endpoint identity / state is in the DB, but the policy *functions* attached to endpoints live in code, referenced by name.
