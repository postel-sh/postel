# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | New standalone `@postel/mysql` + MySQL dialect across all five ORM/query-builder adapters (drizzle/kysely/prisma/typeorm/mikro-orm). New helper exports (`MYSQL_MIGRATIONS`/`MYSQL_CODEC`/`MYSQL_CAPABILITIES`). No change to the cross-port `Storage` interface. |
| typescript-receiver | modified | `@postel/mysql` also exports `MysqlDedup` (inbound dedup); receiver dedup contract unchanged, new backing store only. |
| go-sender (planned) | unchanged | Each port picks its own MySQL driver + adapter packages; the three-category model and the operation-shaped `Storage` interface are the shared concept, not the npm names or the MySQL column-type translation. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | |
| rust-receiver (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | MySQL is a dialect translation of the existing canonical schema (same tables/columns/versions), shipped in `@postel/storage-helpers` like the SQLite dialect. No canonical-schema change. |

## Lockstep / lag

TypeScript-port adapter additions only. The cross-port CONTRACT — the operation-shaped `Storage` interface, the three adapter categories, worker-reservation + polling-fallback semantics — is unchanged. The MySQL column-type translation (BIGINT epoch-millis timestamps, JSON, VARCHAR keys) and the select-then-update reservation are reference-implementation mechanics marked PORT-SPECIFIC in the new requirement's Conformance note, so no other port leads or lags on this.
