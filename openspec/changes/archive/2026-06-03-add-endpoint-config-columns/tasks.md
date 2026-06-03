## 1. Migration

- [x] 1.1 Author `db-schema-delta.sql` — `ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS` for `allow_http boolean NOT NULL DEFAULT false` (`-- SQLite: INTEGER`), `max_inflight integer`, `http jsonb` / `circuit_breaker jsonb` / `auto_disable jsonb` (`-- SQLite: TEXT`); bump `_postel_meta.schema_version` to `'4'`. Forward-only, idempotent.

## 2. Reference adapter realignment

- [x] 2.1 `core/src/storage/memory/adapter.ts` — `SCHEMA_VERSION` `3` → `4`.
- [x] 2.2 `core/test/storage.test.ts` — "Schema version handshake" expects `4`.

## 3. Spec

- [x] 3.1 `storage-layer` MODIFY "Schema is a fixed set of canonical tables": add the endpoints delivery-config-columns scenario + prose; widen the migrations list.

## 4. Verify + archive

- [x] 4.1 `openspec validate add-endpoint-config-columns --strict`.
- [x] 4.2 `pnpm --filter @postel/core test && pnpm --filter @postel/core typecheck`.
- [x] 4.3 `mise run check:all`.
- [x] 4.4 `openspec archive add-endpoint-config-columns -y` + `git mv` the migration to `specs/db-schema/0004_endpoint_config_columns.sql`.
