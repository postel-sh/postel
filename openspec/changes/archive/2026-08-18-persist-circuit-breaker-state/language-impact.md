# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | `CircuitBreakerRegistry` reconciles from persisted `endpoint.state` + `endpoint_state_transitions` instead of trusting only its in-process `Map`. |
| typescript-receiver | unchanged | |
| go-sender (planned) | unchanged | Must satisfy the same restart/cross-process coherence outcome (CONTRACT) when built; free to choose its own reconciliation mechanism (PORT-SPECIFIC). |
| python-sender (planned) | unchanged | Same as above. |
| wire-format | unchanged | Circuit state is never carried on the wire. |
| db-schema | unchanged | Reuses existing `endpoints.state` and `endpoint_state_transitions`; no migration. |

## Lockstep / lag

The outcome — circuit-open state survives a worker restart and is visible across processes sharing the same DB — is CONTRACT and must be satisfied by every sender port. The reconciliation mechanism (reading `listStateTransitions` to reconstruct the cooldown clock) is PORT-SPECIFIC; a port MAY instead keep a small DB-backed counters table if that better fits its storage adapters, as long as the restart/cross-process outcome holds.
