## Why

`CircuitBreakerRegistry` keeps failure counts and open/closed state in a per-process `Map` (`core/src/sender/retry/circuit.ts:13`). Under the spec's own deployment model ("same DB, separate worker process"), a process restart strands an endpoint in `circuit-open` with no automatic path back — the in-memory `openedAt` and cooldown clock are lost, and the only close path is `wasOpen`-gated on the same process instance having been the one that opened it (`circuit.ts:63-77`). An operator has to manually intervene to recover a stuck endpoint.

## What Changes

- **Circuit-open recovery survives process restarts and is visible cross-process**, by having `CircuitBreakerRegistry` reconcile from already-persisted state instead of trusting only its local `Map`:
  - The endpoint's own `state` column (already read fresh on every dispatch reservation) is the authority on whether a circuit is currently open — not local memory. A process that has never seen an endpoint before (fresh boot, or a sibling process opened the circuit) trusts `endpoint.state === 'circuit-open'` over an empty local cache.
  - The cooldown clock (`openedAt`) is reconstructed, when not already cached locally, from the existing `endpoint_state_transitions` audit log (`listStateTransitions`) — the most recent transition into `circuit-open`. No new table or column.
  - Once the cooldown elapses, the registry transitions the endpoint back to `active` (`reason: 'circuit-close'`) and lets the next attempt through as a half-open probe, exactly as today's single-process cooldown-close behavior — this now also fires correctly after a restart.
- **No DB-backed failure counters.** Per-process failure counts remain local and approximate across concurrent processes (a process still needs its own K consecutive failures to trip the breaker); this is out of scope for this issue, whose acceptance criteria is restart recovery, not cross-process failure aggregation. The reconciliation approach adds zero storage surface, versus a DB-backed-counters design which would require a new table/columns and per-attempt writes on the hot path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `retry-policy`: ADDED "Circuit breaker state persists across restarts and processes" [PORT-SPECIFIC] — outcome (coherent, restart-surviving circuit state) is CONTRACT; the reconciliation mechanism is PORT-SPECIFIC.

## Wire-format / DB-schema impact

None. Reconciliation reuses the existing `endpoints.state` column and `endpoint_state_transitions` audit table (both already canonical per `specs/db-schema/0001_init.sql`). No migration.

## Impact

- `@postel/core`: `sender/retry/circuit.ts` (reconcile-from-storage on first touch of an endpoint key, per-process), `sender/retry/orchestrator.ts` (thread the endpoint's current persisted `state` into `isOpen`/`recordOutcome` calls — it's already in scope as part of `EndpointWithSecrets`).
- No adapter changes: `listStateTransitions` and `transitionState` are pre-existing `Storage` interface methods every adapter already implements.
