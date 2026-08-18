## 1. DB schema

- [x] 1.1 Add `specs/db-schema/0007_received_messages_dedup_table.sql`: canonical `postel_received_messages` table (`message_id` PK, `expires_at` NOT NULL) + `expires_at` index, Postgres dialect with `-- SQLite:` and `-- MySQL:` inline variants.

## 2. Align dedup backends to the canonical shape

- [x] 2.1 `packages/storage/pg/src/storage.ts`: add the `postel_received_messages_expires_idx` index next to the ad-hoc `CREATE TABLE`, matching `PgDedup`'s `ensurePgDedupTable`.
- [x] 2.2 `packages/storage/sqlite/src/storage.ts`: add the `postel_received_messages_expires_idx` index next to the ad-hoc `CREATE TABLE`, matching `SqliteDedup`'s `ensureTable`.
- [x] 2.3 `packages/storage/mysql/src/storage.ts`: confirm already aligned (inline index matches `MysqlDedup`) — no change expected.

## 3. Testkit assertion

- [x] 3.1 `packages/storage/testkit/src/index.ts`: export `CANONICAL_DEDUP_COLUMNS` (`["message_id", "expires_at"]`), the single source of truth the three dedup test suites assert against.
- [x] 3.2 `packages/storage/pg/test/dedup.test.ts`: assert the DDL declares exactly the canonical columns.
- [x] 3.3 `packages/storage/sqlite/test/dedup.test.ts`: assert the real `PRAGMA table_info` column set matches the canonical columns.
- [x] 3.4 `packages/storage/mysql/test/dedup.test.ts`: assert the DDL declares exactly the canonical columns.

## 4. Verification

- [x] 4.1 Run `mise run check:all` at the repo root.
- [x] 4.2 Run the `@postel/pg`, `@postel/sqlite`, `@postel/mysql`, `@postel/storage-testkit` test/lint/typecheck/build chains.
