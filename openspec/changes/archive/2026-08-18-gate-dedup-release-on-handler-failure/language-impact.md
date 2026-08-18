# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-receiver | modified | `DedupAdapter` gains optional `release(messageId)`; `InMemoryDedup`, `PgDedup`, `SqliteDedup`, `MysqlDedup` implement it. `handleInbound` releases the dedup record when `onVerified` throws after a fresh (non-duplicate) record, so a retry reaches the handler again. |
| typescript-sender | unchanged | Outbound signing/dispatch untouched. |
| go-receiver (planned) | unchanged | The CONTRACT is the wire outcome: a handler failure must not permanently burn the id, and dedup must still short-circuit a known duplicate before the handler runs. How a port's dedup adapter undoes a record (delete, TTL bump, tombstone) is PORT-SPECIFIC. |
| go-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | |
| rust-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | |
| wire-format | unchanged | No new header, status, or field — `2xx` + `X-Postel-Dedup-Result: duplicate` is unchanged. |
| db-schema | unchanged | `release` deletes from the same dedup table `record()` already writes; no new table or column. |

## Lockstep / lag

The CONTRACT is the outcome — a throwing gate handler must not permanently consume the webhook-id, and a genuinely duplicate delivery must still skip the handler before it runs. The mechanism (an optional `release` method that deletes the just-written row) is a TypeScript-port implementation detail; other ports are free to achieve the same outcome differently (e.g. a status column instead of a bare expiry timestamp).
