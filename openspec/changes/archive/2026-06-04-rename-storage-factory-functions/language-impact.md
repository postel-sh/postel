# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | Identifier rename only: storage factories `postelXxx` → `XxxStorage`, options `PostelXxxOptions` → `XxxStorageOptions`. No runtime/behavior change; no package-name (import specifier) change. |
| typescript-receiver | modified | Receiver-side dedup factory rename `pgDedupAdapter`/`sqliteDedupAdapter` → `PgDedup`/`SqliteDedup`, options `XxxDedupAdapterOptions` → `XxxDedupOptions`. Behavior unchanged. |
| go-sender (planned) | unchanged | Each port names its own factories; the cross-port CONTRACT is the operation-shaped `Storage` interface, not the TS identifiers. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | |
| rust-receiver (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

Identifier-only change in the TypeScript port. The cross-port CONTRACT (the `Storage` and `DedupAdapter` interfaces, the three adapter categories) is unaffected — factory function names are TypeScript-port-specific, so no other port lags or leads on this.
