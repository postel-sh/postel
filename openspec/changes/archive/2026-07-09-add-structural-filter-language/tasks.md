## 1. Core types

- [x] 1.1 Add `StructuralFilterClause` (`{ dataPath: string; equals: Json }`), `StructuralFilter` (clause or array), and `FilterEnvelope` (`{ type; data; channels?; timestamp? }`) to `typescript/packages/core/src/outbound.ts`.
- [x] 1.2 Change `EndpointCreateOptions.filter` to `StructuralFilter`; add `filterFn?: (event: FilterEnvelope) => boolean`; add `filter` to the `Endpoint` read-shape interface (remove it from the "absent keys" set); `EndpointUpdateOptions` inherits both via `Partial`.
- [x] 1.3 `storage/types.ts`: `EndpointRecord.filter` becomes `StructuralFilter | null` (real, persisted); add `EndpointRecord.filterFn: ((event: FilterEnvelope) => boolean) | null` (code-side); update `NewEndpoint`'s Omit/Partial list to treat `filterFn`/`transform` as the code-side-optional pair (drop `filter` from that special-cased list — it behaves like `types`/`channels` now).

## 2. Dispatch evaluation

- [x] 2.1 `sender/dispatcher/filter-transform.ts`: add a `matchesStructuralFilter(filter, data)` helper (dot-path traversal + deep-equal against `equals`; array clauses ANDed); call it in `evaluateFilter` after the `types`/`channels` checks and before the `filterFn` predicate.
- [x] 2.2 `sender/dispatcher/http-dispatcher.ts`: read `endpoint.filterFn` (typed) instead of `typeof endpoint.filter === "function"`.

## 3. Endpoint CRUD + read shape

- [x] 3.1 `sender/endpoint/crud.ts`: `toPublicEndpoint` includes `filter`; `create`/`update` pass `filter` straight through (real field) and keep `filterFn` in the code-side-optional treatment `transform` already gets.
- [x] 3.2 `storage/memory/adapter.ts`: rename the in-memory adapter's function-slot handling from `filter` to `filterFn`; store the real `filter` value like any other JSON field.

## 4. Storage helpers + SQL adapters

- [x] 4.1 `storage/helpers/src/index.ts`: `encodeEndpointInsert`/`decodeEndpoint` gain the real `filter` column (JSON encode/decode, like `metadata`); rename `EndpointCallbacks.filter` → `filterFn` and update `createCallbackRegistry`/`attachCallbacks` accordingly.
- [x] 4.2 Each of `pg`, `mysql`, `sqlite`, `kysely`, `drizzle`, `typeorm`, `prisma`, `mikro-orm`: rename `registry.set(...)`/`applyPatch(...)` calls from `filter` to `filterFn`; rename the `"filter" in patch` guard to `"filterFn" in patch`.
- [x] 4.3 `pg`, `mysql`, `sqlite` additionally: add `filter` to the hand-written `UPDATE endpoints SET ...` column list and params (the other five adapters derive their update column list dynamically from `encodeEndpointInsert` and need no further change).
- [x] 4.4 Bump `InMemoryStorage.schemaVersion()` to `5` (mirrors the precedent set when `0004` added delivery-config columns).

## 5. DB schema

- [x] 5.1 Add `specs/db-schema/0005_endpoint_structural_filter.sql` (`ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS filter jsonb`, bump `_postel_meta.schema_version` to `5`).

## 6. Tests

- [x] 6.1 `dispatcher.test.ts`: rename existing predicate-filter tests to use `filterFn`; add structural-filter tests covering the new spec scenarios (single clause match/mismatch, nested path, ANDed array, missing path, filterFn-after-filter ordering).
- [x] 6.2 `storage.test.ts`: update the schema-version assertion to `5`.
- [x] 6.3 `storage/helpers/test/helpers.test.ts`: rename `CallbackRegistry` test fixtures from `filter` to `filterFn`.
- [x] 6.4 Update the "Function-shaped options stay off the read shape" test and add a "filter round-trips" test per adapter's conformance suite (or the shared conformance test, if one exists) confirming `filter` now round-trips.

## 7. Docs

- [x] 7.1 `docs/content/docs/outbound/endpoints.mdx`: replace the function-predicate `filter` example with the structural shape; document `filterFn` as the renamed, still-process-local escape hatch.
- [x] 7.2 Grep `admin/src/index.ts` and `docs/content/docs/outbound/admin.mdx` for claims that filter/transform never cross the wire; update to reflect that `filter` now does (only `filterFn`/`transform` don't).

## 8. Verification

- [x] 8.1 Run `mise run check:all` at the repo root.
- [x] 8.2 Run the `@postel/core` and all 8 storage-adapter packages' test/lint/typecheck/build chains.
