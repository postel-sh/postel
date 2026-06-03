## 1. Migration

- [x] 1.1 Author `db-schema-delta.sql` — `ALTER TABLE messages ADD COLUMN IF NOT EXISTS` for `attempt_number integer NOT NULL DEFAULT 0`, `scheduled_for timestamptz` (`-- SQLite: TEXT`), `replay_of text` (`-- SQLite: TEXT`); partial index `messages_scheduled_idx` on `scheduled_for`; bump `_postel_meta.schema_version` to `'3'`. Forward-only, idempotent.

## 2. Reference adapter realignment

- [x] 2.1 `core/src/storage/memory/adapter.ts` — `SCHEMA_VERSION` `1` → `3`.
- [x] 2.2 `core/test/storage.test.ts` — "Schema version handshake" expects `3`.

## 3. Spec

- [x] 3.1 `storage-layer` MODIFY "Schema is a fixed set of canonical tables": add the messages dispatch-state-columns scenario + widen the canonical-DDL pointer to the migrations directory.

## 4. Verify + archive

- [x] 4.1 `openspec validate add-message-dispatch-columns --strict`.
- [x] 4.2 `cd typescript && pnpm --filter @postel/core test && pnpm --filter @postel/core typecheck` (handshake test green).
- [x] 4.3 `mise run check:all`.
- [x] 4.4 `openspec archive add-message-dispatch-columns -y` (moves the migration to `specs/db-schema/0003_message_dispatch_columns.sql`).
