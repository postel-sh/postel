# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | structural `filter` becomes real persisted data; `filterFn` renames the old function field |
| typescript-receiver | unchanged | |
| go-sender (planned) | unaffected | mechanism (registry, column encoding) is TypeScript-port-specific; the structural filter's matching OUTCOME is CONTRACT |
| go-receiver (planned) | unaffected | |
| python-sender (planned) | unaffected | same CONTRACT obligation as go-sender |
| python-receiver (planned) | unaffected | |
| wire-format | unchanged | filtering happens dispatch-side against the already-parsed event; nothing on the wire changes |
| db-schema | modified | new `endpoints.filter` column (migration 0005); see `db-schema-delta.sql` |

## Lockstep / lag

Only the TypeScript port changes now. Other ports MAY lag on the mechanism (whether `filter` lives in a real column vs. another representation) but MUST honor the CONTRACT outcome once they implement outbound endpoints: `filter`'s dataPath/equals matching is deterministic and serializable, `filterFn`-equivalent escape hatches are process-local, and `types`/`channels`/`filter`/`filterFn` compose as AND.
