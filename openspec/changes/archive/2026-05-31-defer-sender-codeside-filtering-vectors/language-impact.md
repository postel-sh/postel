# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | Swaps the no-op `transform-reshapes-body` vector for `channel-filter-no-match`; converts the `Filter and transform errors fail closed` unit test from a placeholder to a real assertion. No sender-runtime behavior change. |
| typescript-receiver | unchanged | |
| go-sender (planned) | unchanged | Net simplification — future ports no longer need a control-plane mechanism to inject host transform/predicate callbacks to be v0.2-conformant; those behaviors stay in each port's unit suite. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

Shrinks the v0.2.0 corpus's `filtering-transformation` contract set to the two wire-expressible filter shapes (type-glob, channel); no port is forced to change in lockstep. Transform-produces-body and fail-closed remain CONTRACT, covered per-port by unit tests, and become candidates for the corpus only if a named-callback control-plane mechanism is designed in a later MINOR.
