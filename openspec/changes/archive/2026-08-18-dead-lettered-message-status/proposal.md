## Why

When a message exhausts retries, `dispatchMessage` finalizes it with `markMessageFinal(id, 'dispatched')` — the same status as a successful delivery — because `MessageStatus` is only `'pending' | 'dispatched' | 'expired'`. Dead-letter exists solely as an attempt status and a fire-and-forget event; `outbound.messages.list` cannot filter for permanently-failed messages. An operator cannot answer "what failed permanently?" — the core reliability question. This is a cross-port CONTRACT and canonical-DB-schema change, so it must land pre-1.0 (breaking-if-deferred).

## What Changes

- **`MessageStatus` gains `'dead-lettered'`**: `'pending' | 'dispatched' | 'dead-lettered' | 'expired'`.
- **Finalization rule**: when a message has no more retryable endpoint work, it is finalized `dead-lettered` if at least one endpoint reached `dead-letter` and none succeeded; otherwise it stays `dispatched` (a fanout where at least one endpoint delivered is still a dispatched message, even if a sibling permanently failed).
- **`outbound.messages.list({ status: 'dead-lettered' })`** and the admin `GET /messages?status=dead-lettered` filter (already generic over `MessageStatus`) return exactly the permanently-failed messages.
- **BREAKING**: `markMessageFinal`'s status parameter widens from `"dispatched" | "expired"` to include `"dead-lettered"`; a host reading raw `messages.status` values must now handle the new value.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `message-introspection`: MODIFIED "Read a message by id" (outbox status vocabulary gains `dead-lettered`); MODIFIED "List and filter messages" (ADDED scenario: filter by dead-lettered status).
- `retry-policy`: ADDED "Message finalized as dead-lettered on exhaustion" — the write-side rule deciding when the outbox row (not just the attempt) becomes `dead-lettered`.

## Wire-format / DB-schema impact

Wire-format: unchanged (message status is never carried on the wire to receivers). DB-schema: `messages.status` is a free-text column with no CHECK constraint, so no column/table DDL changes — but the canonical vocabulary documented alongside it changes, so `db-schema-delta.sql` bumps `_postel_meta.schema_version` and updates the column comment for the next-numbered migration.

## Impact

- `@postel/core`: `storage/types.ts` (`MessageStatus`, `markMessageFinal` signature), `sender/dispatcher/dispatch.ts` (finalization decision), `storage/memory/adapter.ts` (`SCHEMA_VERSION` bump).
- `@postel/storage-helpers`: `migrations.ts` (new version-6 entry in `SQLITE_MIGRATIONS` / `PG_MIGRATIONS` / `MYSQL_MIGRATIONS` bumping `schema_version`; no column DDL needed).
- All 8 SQL storage adapters (`pg`, `mysql`, `sqlite`, `kysely`, `drizzle`, `typeorm`, `prisma`, `mikro-orm`): `markMessageFinal` is a generic pass-through with no per-status branching, so no adapter code changes beyond picking up the widened `Storage` interface type; the shared `testkit` conformance battery gains coverage exercising the new status end-to-end on every adapter.
- `@postel/admin`: no code change — `GET /messages?status=` already parses and forwards arbitrary `MessageStatus` values generically.
- `specs/db-schema/`: new `0006_dead_lettered_message_status.sql` migration.
- Docs: `docs/content/docs/outbound/messages.mdx` (the `message?.status` vocabulary snippet).
