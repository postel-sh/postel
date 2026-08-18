## 1. Registry reconciliation

- [x] 1.1 `sender/retry/circuit.ts`: `isOpen`/`recordOutcome` accept the endpoint's current persisted `state` (`EndpointState`) alongside the ids already passed. When a key has no local cache entry and the persisted state is `circuit-open`, reconcile: look up the most recent `circuit-open` transition via `storage.endpoints.listStateTransitions(endpointId)` for `openedAt`, seed local state as `open`.
- [x] 1.2 When a key has no local cache entry and the persisted state is `active`, seed local state as `closed` (no reconciliation query needed).
- [x] 1.3 Cooldown-elapsed close path (existing behavior) still transitions to `active` / `reason: 'circuit-close'` and clears local state, now reachable after a restart.

## 2. Orchestrator wiring

- [x] 2.1 `sender/retry/orchestrator.ts`: pass `endpoint.state` into `circuit.isOpen(...)` and `circuit.recordOutcome(...)`.

## 3. Tests

- [x] 3.1 `core/test/retry.test.ts`: add "Circuit breaker state persists across restarts and processes" tests — (a) restart simulation: open a circuit, construct a *new* `CircuitBreakerRegistry` instance (same storage) simulating a process restart, advance the clock past cooldown, and assert the endpoint recovers (probe attempt allowed, endpoint transitions back to `active`) without manual intervention; (b) cross-process visibility: two independently-constructed registries sharing the same storage — one opens the circuit, the other sees `isOpen() === true` for that endpoint via persisted state before its own local failure count reaches threshold.

## 4. Verification

- [x] 4.1 Run `mise run check:all` at the repo root.
- [x] 4.2 Run `@postel/core`'s test/lint/typecheck/build chain.
