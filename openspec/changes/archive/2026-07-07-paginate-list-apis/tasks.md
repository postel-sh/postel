# Tasks

## 1. Spec

- [x] 1.1 MODIFY `storage-layer` *BYO storage interface* — paginate `endpoints.list` / `listMessages`; `reconcile` becomes a bounded paged read; state the shared keyset-cursor convention.
- [x] 1.2 MODIFY `endpoint-management` *Endpoint CRUD*; ADD *List endpoints (paginated)*.
- [x] 1.3 MODIFY `message-introspection` *List and filter messages* — page envelope + cursor continuation.
- [x] 1.4 MODIFY `replay-reconciliation` *Reconciliation API* — bounded page, cursor resume.
- [x] 1.5 MODIFY `observability` *Admin HTTP handlers* — pagination on `GET /endpoints`, `GET /messages`, `POST /reconcile`.
- [x] 1.6 MODIFY `api-surface-typescript` *Postel factory returns the library instance* — generalize the `Page<T>` / `CursorOptions` note.
- [x] 1.7 ADR 0015 — pagination envelope convention for the ports to mirror.

## 2. Shared abstractions

- [x] 2.1 `@postel/storage-helpers`: `encodeKeysetCursor` / `decodeKeysetCursor` (tenant codec delegates), `DEFAULT_ENDPOINT_LIST_LIMIT`, `DEFAULT_RECONCILE_LIMIT`.

## 3. Storage

- [x] 3.1 `storage/types.ts`: `EndpointListFilter`; `MessageListFilter` gains `cursor`; `ReconcileFilter` gains `limit` / `cursor`; page-returning `endpoints.list` / `listMessages` / `reconcile`.
- [x] 3.2 In-memory adapter: paginate all three reads.
- [x] 3.3 SQL adapters (pg, sqlite, mysql, kysely, drizzle, prisma, typeorm, mikro-orm): paginate all three reads.
- [x] 3.4 Testkit battery: identical conformance coverage for endpoint / message / reconcile pagination, naming the `storage-layer` requirement.

## 4. Core public API

- [x] 4.1 `outbound.ts` + `sender/endpoint/crud.ts` + `sender/replay/replay.ts`: page-returning `endpoints.list` / `messages.list` / `reconcile` with limit validation; `publicJwks` pages through storage.
- [x] 4.2 Export any new public types from `@postel/core` root.

## 5. Admin HTTP

- [x] 5.1 `@postel/admin`: `limit` / `cursor` on `GET /endpoints`, `GET /messages`, `POST /reconcile`; `{ <plural>, nextCursor }` bodies; malformed cursor → 400.

## 6. Tests + docs

- [x] 6.1 Core tests: endpoint list pagination, message list cursor walk, bounded reconcile page.
- [x] 6.2 Admin route tests: pagination params, envelope bodies, malformed cursor → 400 on each route.
- [x] 6.3 Docs: outbound endpoints / messages / replay pages and admin pages; document the envelope convention.

## 7. Verify + archive

- [x] 7.1 `openspec validate paginate-list-apis --strict`; TS chain (typecheck / test / lint / build).
- [x] 7.2 `openspec archive paginate-list-apis -y`; `mise run check:all`.
- [x] 7.3 PR referencing #84 and the modified capability specs.
