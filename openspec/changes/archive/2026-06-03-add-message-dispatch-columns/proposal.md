## Why

The canonical `messages` DDL in `specs/db-schema/0001_init.sql` is missing three columns that the `Storage` contract and the in-memory reference adapter already depend on. `ReservedMessage` (returned by `reserveBatch`) carries `attemptNumber`, `scheduledFor`, and `replayOf`, and the in-memory `MessageRow` tracks all three — but the SQL schema has no `attempt_number`, `scheduled_for`, or `replay_of` column on `messages`. Any SQL-backed `Storage` adapter (the Tier-1 standalone + ORM adapters about to land) cannot persist reservation attempt counts, retry-backoff scheduling, or replay tagging, and would fail the moment it round-trips a `ReservedMessage`. The gap was never caught because the only adapter so far is in-memory.

Separately, the in-memory adapter's schema-version handshake has drifted: migration `0002` bumped `_postel_meta.schema_version` to `'2'`, but `InMemoryStorage.schemaVersion()` still returns `1`. This change realigns the reference adapter with the canonical schema version.

## What Changes

- **New forward-only migration `0003_message_dispatch_columns.sql`** adds three columns to `messages`: `attempt_number integer NOT NULL DEFAULT 0` (incremented on each reservation), `scheduled_for timestamptz` (retry-backoff time; workers skip rows scheduled in the future), and `replay_of text` (set on a replay so the row's attempts are tagged as replay traffic). Idempotent (`ADD COLUMN IF NOT EXISTS`); `replay_of` is a plain column because SQLite `ALTER TABLE ADD COLUMN` cannot add a foreign key, so the reference to `messages(id)` is enforced application-side. Bumps `_postel_meta.schema_version` to `'3'`.
- **`InMemoryStorage.schemaVersion()` returns `3`** — the canonical current, correcting the pre-existing `1`-vs-`2` drift and matching the schema after `0003`. The in-memory `MessageRow` already tracks attempt / scheduled / replay state, so there is no reservation-behavior change.
- **`storage-layer` "Schema is a fixed set of canonical tables"** gains a scenario asserting `messages` carries the dispatch-state columns, and its source-of-truth pointer is widened from `0001_init.sql` to the migrations directory.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`storage-layer`** — MODIFY *Schema is a fixed set of canonical tables*: require the `messages` dispatch-state columns (`attempt_number`, `scheduled_for`, `replay_of`) and widen the canonical-DDL pointer to the migrations directory.

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: **changed** — new forward-only migration `0003_message_dispatch_columns.sql` adds three columns to `messages` and bumps `schema_version` to `'3'`. Forward-only and idempotent; existing rows default `attempt_number` to `0` and `scheduled_for` / `replay_of` to `NULL`.

## Impact

- `specs/db-schema/0003_message_dispatch_columns.sql` — new migration (authored here as `db-schema-delta.sql`; moved on archive).
- `typescript/packages/core/src/storage/memory/adapter.ts` — `SCHEMA_VERSION` `1` → `3`.
- `typescript/packages/core/test/storage.test.ts` — handshake test expects `3`.
- Unblocks the Tier-1 SQL adapters (`@postel/pg`, `@postel/sqlite`, `@postel/kysely`, `@postel/drizzle`, `@postel/prisma`), which persist these columns.
