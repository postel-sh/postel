# Language impact

Pure spec refactor; no code yet. Tightens existing requirements, eliminates duplication, and moves one requirement into the capability that owns its semantics. Same outcomes apply to every future language port — these are cross-language contracts.

| Port | Status | Notes |
|---|---|---|
| typescript-sender | unchanged | Lease lifecycle is owned by storage-layer; TS sender consumes it |
| typescript-receiver | unchanged | No receiver-side surface changes |
| go-sender (planned) | unchanged | Inherits the tightened contracts |
| go-receiver (planned) | unchanged | Same |
| python-sender (planned) | unchanged | Same |
| python-receiver (planned) | unchanged | Same |
| wire-format | unchanged | |
| db-schema | unchanged | Lease columns already in `0001_init.sql`; this change formalizes their semantics |

## Lockstep / lag

No lockstep concerns. The deduplication (filter/transform moved out of `sender`, replay-safety moved out of `retry-policy`) and the canonical JWKS source narrow the surface that ports need to honor; no port falls behind.
