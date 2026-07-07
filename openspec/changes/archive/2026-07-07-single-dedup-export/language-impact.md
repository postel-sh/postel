# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-receiver | modified | Public-surface trim only: `inMemoryDedupAdapter` and the top-level `dedup(messageId, { ttl, adapter })` sugar leave `@postel/core`; `InMemoryDedup(options?)` is the single in-memory dedup factory and `postel.inbound.<source>.dedup` is the only dedup entry point. Behavior (atomicity, TTL, concurrent race) unchanged. |
| typescript-sender | unchanged | |
| go-receiver (planned) | unchanged | Ports name their own factories; the cross-port CONTRACT is the `DedupAdapter` semantics and the source-scoped helper behavior, both unchanged. |
| go-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | |
| rust-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

TypeScript-port identifier trim, done before any 1.0 publish so no released name churns. The `receiver` spec rewording (source-scoped helper instead of top-level `postel.dedup`) tightens the contract phrasing all ports implement; no port lags or leads — the behavior scenarios are identical.
