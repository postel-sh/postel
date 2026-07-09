## Why

`EndpointCreateOptions.filter: (event: unknown) => boolean` sits beside `url`/`types` but is radically different: it can't serialize, can't cross the admin HTTP API, and on real (non-in-memory) storage lives in a process-local registry — after a restart the filter silently no longer exists unless the host re-registers it. The field's shape implies persistence; its actual semantics are per-process. Most real filters are a simple "does this data field equal this value" check, which doesn't need arbitrary code to express — a serializable structural filter covers that common case, is portable to other language ports, and is safe to round-trip through the admin API and real storage.

## What Changes

- **`filter` becomes a serializable structural filter**: `{ dataPath, equals }` (or an array of such clauses, ANDed) — matches when the event's `data` at the dot-separated `dataPath` deep-equals `equals` (a JSON value). Persisted for real: a new `filter` column on `endpoints`, encoded/decoded like every other JSON config field, no code-side registry involved.
- **The function escape hatch is renamed to `filterFn`** and typed `(event: FilterEnvelope) => boolean` — a concrete envelope (`{ type, data, channels?, timestamp? }`) instead of `unknown`. `filterFn` keeps today's semantics exactly: code-side only, held in the per-adapter callback registry, ephemeral across restarts on non-memory storage.
- **Both apply, ANDed with `types`/`channels`**: type/channel filters run first (unchanged), then the structural `filter`, then `filterFn` — any failing clause filters the event.
- **BREAKING**: `filter`'s type changes from a predicate function to the structural shape. Existing callers move their predicate to `filterFn`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `filtering-transformation`: MODIFIED "Predicate filter" → renamed to reference `filterFn` and the typed `FilterEnvelope`; ADDED "Structural filter matches a data path" (the new `filter` shape and its AND-with-clauses semantics).
- `endpoint-management`: MODIFIED "Endpoint CRUD" — `filter` is now a serializable field that round-trips on the read shape; `filterFn` (renamed from `filter`) and `transform` are the function-shaped fields that stay off it.
- `storage-layer`: MODIFIED "Schema is a fixed set of canonical tables" — `endpoints` gains a `filter` column.

## Wire-format / DB-schema impact

Wire-format: unchanged (the structural filter is evaluated dispatch-side against the already-parsed event; it never appears on the wire). DB-schema: new forward-only migration adding `endpoints.filter` (JSON), bumping `_postel_meta.schema_version`.

## Impact

- `@postel/core`: `outbound.ts` (`EndpointCreateOptions`/`EndpointUpdateOptions`/`Endpoint` gain `filter: StructuralFilter`/`FilterEnvelope` types, `filterFn` replaces the old `filter` function field), `storage/types.ts` (`EndpointRecord.filter` becomes the structural type; `EndpointRecord.filterFn` replaces the function `filter`), `sender/dispatcher/filter-transform.ts` (structural clause evaluation), `sender/dispatcher/http-dispatcher.ts`, `sender/endpoint/crud.ts` (read-shape + create/update wiring), `storage/memory/adapter.ts`.
- `@postel/storage-helpers`: `encodeEndpointInsert`/`decodeEndpoint` gain the real `filter` column; `CallbackRegistry`/`EndpointCallbacks` renamed `filter` → `filterFn`.
- All 8 SQL storage adapters (`pg`, `mysql`, `sqlite`, `kysely`, `drizzle`, `typeorm`, `prisma`, `mikro-orm`): pick up the renamed registry field; `pg`/`mysql`/`sqlite` additionally add the new column to their hand-written `UPDATE endpoints` statement (the other five derive their update column list dynamically from the encoded row and need no change there).
- Docs: `docs/content/docs/outbound/endpoints.mdx`, `docs/content/docs/reference/errors.mdx` (unaffected), admin docs noting `filter` now crosses the wire.
