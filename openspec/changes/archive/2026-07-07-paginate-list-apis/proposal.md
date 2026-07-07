# Pagination envelopes on all list-returning APIs

## Why

`endpoints.list()`, `messages.list()`, admin `GET /endpoints` / `GET /messages`, and `reconcile()` all return unbounded arrays today; only `tenants.list` (PR #82) is paginated. Retrofitting pagination after 1.0 is a return-shape change — breaking — so every list-returning surface must adopt the envelope before the contract freezes. Issue #84 is a go-live blocker for M3.

## What Changes

- **One envelope, everywhere.** Every list-returning read adopts the shape `tenants.list` established: `{ limit?, cursor? }` in (`CursorOptions`), `{ items, nextCursor }` out (`Page<T>`), opaque base64url keyset cursor over `(createdAt, id)`, a conservative default limit (100) when none is given, and no offset pagination. The convention is recorded once in ADR 0015 for the other ports to mirror.
- **`endpoints.list`** — storage `endpoints.list` accepts `limit` / `cursor` in its filter and returns a newest-first `Page<EndpointRecord>`; public `outbound.endpoints.list(opts)` gains `limit` / `cursor` and returns `Page<Endpoint>`. Internal iterate-all consumers (e.g. `publicJwks`) page through storage rather than assuming an unbounded array.
- **`messages.list`** — `MessageListFilter` gains `cursor` (it already had `limit` with a default); storage `listMessages` returns `Page<StoredMessage>`; public `outbound.messages.list` returns `Page<Message>`.
- **`reconcile`** — storage `reconcile(filter)` becomes a bounded paged read (`Promise<Page<MessageId>>`, oldest-first, `ReconcileFilter` gains `limit` / `cursor`) instead of an unbounded `AsyncIterable<MessageId>`; public `outbound.reconcile(opts)` gains `limit` / `cursor` and returns `Page<MessageId>` instead of draining every missed id into one array.
- **Admin routes** — `GET /endpoints`, `GET /messages`, and `POST /reconcile` gain `limit` / `cursor` parameters and return the envelope with `nextCursor` (`{ endpoints, nextCursor }`, `{ messages, nextCursor }`, `{ messageIds, nextCursor }`), mirroring `GET /tenants`' established `{ <plural>, nextCursor }` key naming and its malformed-cursor → `400 INVALID_QUERY` mapping.

## Capabilities

### Modified Capabilities

- **`storage-layer`** — MODIFY *BYO storage interface*: `endpoints.list` and `listMessages` return keyset-paginated pages; `reconcile` becomes a bounded paged read; the shared keyset-cursor convention is stated once.
- **`endpoint-management`** — MODIFY *Endpoint CRUD* (list returns a page); ADD *List endpoints (paginated)*.
- **`message-introspection`** — MODIFY *List and filter messages*: results are a `{ items, nextCursor }` page with cursor continuation.
- **`replay-reconciliation`** — MODIFY *Reconciliation API*: the result is a bounded page of message ids, resumable via cursor.
- **`observability`** — MODIFY *Admin HTTP handlers*: pagination parameters and envelopes on `GET /endpoints`, `GET /messages`, `POST /reconcile`; malformed-cursor → 400 extended to every cursor-accepting route.
- **`api-surface-typescript`** — MODIFY *Postel factory returns the library instance*: the `Page<T>` / `CursorOptions` shape note generalizes from tenants to every list-returning read.

## Wire-format / DB-schema impact

Wire-format: unchanged (reads and admin JSON bodies only; no webhook wire change). DB-schema: unchanged — keyset cursors use the existing `created_at` + `id` columns already indexed by the reservation/list paths.

## Impact

- `@postel/core`: `EndpointListFilter`; `MessageListFilter` gains `cursor`; `ReconcileFilter` gains `limit` / `cursor`; `Storage.endpoints.list` / `Storage.listMessages` / `Storage.reconcile` return pages; public `outbound.endpoints.list` / `outbound.messages.list` / `outbound.reconcile` return pages; in-memory adapter updated.
- `@postel/storage-helpers`: generic `encodeKeysetCursor` / `decodeKeysetCursor` (the tenant codec delegates to them), `DEFAULT_ENDPOINT_LIST_LIMIT`, `DEFAULT_RECONCILE_LIMIT`.
- Storage adapters (`pg`, `sqlite`, `mysql`, `kysely`, `drizzle`, `prisma`, `typeorm`, `mikro-orm`): paginate `endpoints.list` / `listMessages` / `reconcile`; testkit battery gains identical conformance coverage for all three.
- `@postel/admin`: pagination on the three routes above.
- `decisions/0015-pagination-envelope.md`: the cross-port envelope convention, recorded once.
- Docs + tests updated accordingly.
