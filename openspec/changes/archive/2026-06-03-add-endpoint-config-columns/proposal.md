## Why

`EndpointRecord` carries five delivery-config fields the public API persists — `allowHttp`, `maxInflight`, `http`, `circuitBreaker`, `autoDisable` — set on every `endpoints.create` / `endpoints.update` (see `sender/endpoint/crud.ts`). But the canonical `endpoints` DDL (`0001_init.sql`) has no columns for them. The in-memory adapter hides the gap by storing the whole record in a `Map`; any SQL-backed adapter would have nowhere to persist these fields. This is the endpoint-table analogue of the messages dispatch-columns gap fixed in `add-message-dispatch-columns`, found while building the SQL row codecs.

## What Changes

- **New forward-only migration `0004_endpoint_config_columns.sql`** adds to `endpoints`: `allow_http boolean NOT NULL DEFAULT false`, `max_inflight integer`, `http jsonb`, `circuit_breaker jsonb`, `auto_disable jsonb` (SQLite: `INTEGER` for the boolean, `TEXT` for the JSON columns). Dedicated columns, consistent with the existing per-concern jsonb columns (`retry_policy`, `headers`, `signing`). Idempotent; bumps `_postel_meta.schema_version` to `'4'`.
- **`InMemoryStorage.schemaVersion()` returns `4`**, matching the schema after `0004`.
- **`storage-layer` "Schema is a fixed set of canonical tables"** gains a scenario asserting `endpoints` carries the delivery-config columns.

`to_state NOT NULL` on `endpoint_state_transitions` is intentionally left unchanged: no sender/public path passes a null `toState` — the only null is the in-memory delete-audit transition, which a SQL adapter handles port-specifically (the `ON DELETE CASCADE` removes an endpoint's transitions with it), so the canonical column need not become nullable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`storage-layer`** — MODIFY *Schema is a fixed set of canonical tables*: require the `endpoints` delivery-config columns (`allow_http`, `max_inflight`, `http`, `circuit_breaker`, `auto_disable`).

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: **changed** — new forward-only migration `0004_endpoint_config_columns.sql` adds five columns to `endpoints` and bumps `schema_version` to `'4'`. Existing rows default `allow_http` to `false` and the rest to `NULL`.

## Impact

- `specs/db-schema/0004_endpoint_config_columns.sql` — new migration (authored here as `db-schema-delta.sql`; moved on archive).
- `typescript/packages/core/src/storage/memory/adapter.ts` — `SCHEMA_VERSION` `3` → `4`.
- `typescript/packages/core/test/storage.test.ts` — handshake test expects `4`.
- Unblocks endpoint persistence in the Tier-1 SQL adapters.
