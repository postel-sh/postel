## MODIFIED Requirements

### Requirement: BYO storage interface

The library SHALL document and stabilize a `Storage` interface that every adapter — first-party and third-party — implements. The interface MUST be technology-agnostic (a third-party author MUST NOT need to import any library-internal SQL builder or ORM to implement it), operation-shaped (not CRUD-shaped), and stable across minor versions.

The operation set MUST include at minimum: `insertMessage`, `insertOrReuseByIdempotencyKey`, `reserveBatch`, `recordAttempt`, `releaseLease`, `expireStaleLeases`, `loadEndpointsForMessage`, `rangeQuery` (as a streaming iterable), `reconcile` (as a bounded paged read), `dedup`, `transaction(cb)`, the introspection reads `getMessage` and `listMessages`, and endpoint / secrets / tenant sub-namespaces. The tenant sub-namespace additionally includes the reads `tenants.get` (which accepts the standard host-transaction option, like the other read/write tenant operations) and `tenants.list` (paginated). `notify` and `subscribe` are optional capabilities (see `Optional storage capabilities` below).

Every list-returning read on the interface — `endpoints.list`, `listMessages`, `tenants.list`, and `reconcile` — SHALL share one pagination convention: `{ limit?, cursor? }` in, a `{ items, nextCursor }` page out, bounded by a conservative default limit when the caller gives none, using opaque keyset cursors over `(createdAt, id)` rather than offset pagination. `nextCursor` is `null` on the last page and otherwise an opaque token the caller passes back as `cursor` to fetch the next page. A cursor that cannot be decoded SHALL be rejected with a structured error rather than silently ignored. The convention is recorded for all ports in [ADR 0015](../../../decisions/0015-pagination-envelope.md).

The keyset carries two schema-level invariants (ADR 0015). First, the keyset-ordered `createdAt` columns SHALL be stored at exactly millisecond precision — the cursor encodes millisecond ISO-8601, so a store holding sub-ms values would silently skip or repeat rows across page boundaries; the canonical schema enforces this (`timestamptz(3)` on Postgres, `BIGINT` epoch-milliseconds on MySQL, millisecond ISO-8601 text on SQLite) and adapters do not truncate on read. Second, the `id` tie-break SHALL compare through a deterministic total order in which distinct ids never compare equal; byte order (binary collation) is the canonical cross-port ordering — the MySQL dialect pins `utf8mb4_bin`, and Postgres deterministic locale collations are acceptable because the ordering and the cursor predicate share one collation.

`getMessage(id)` returns a single stored message (metadata + payload + outbox status) by id, or an absent result when none matches. `listMessages(filter)` returns a newest-first page of stored messages filtered by tenant, event type(s), outbox status, and a created-at window. Both back the `message-introspection` capability's read surface; per-message attempt history is read through the existing `attempts` sub-namespace.

`endpoints.list(filter)` returns a newest-first page of endpoint records, optionally scoped to a tenant. It backs the `endpoint-management` capability's list requirement.

`tenants.get(tenantId)` returns a single tenant record by id, or an absent result when none matches. `tenants.list(filter)` returns a newest-first page of tenant records. Both back the `multi-tenancy` capability's tenant-read requirements.

`reconcile(filter)` returns an oldest-first page of message ids whose latest attempt against the given endpoint is not a confirmed delivery, so a caller can walk an arbitrarily large backlog in bounded slices. It backs the `replay-reconciliation` capability's reconciliation requirement.

#### Scenario: Custom adapter against an unsupported backend

- **WHEN** a user implements the `Storage` interface for libSQL / Turso / D1 / CockroachDB / PlanetScale or any other backend, and configures Postel to use it
- **THEN** all sender / receiver / replay APIs work against the custom backend without any library code changes
- **AND** the adapter passes the `@postel/compliance` test suite without modification

#### Scenario: Worker reservation can't be expressed as CRUD

- **WHEN** an adapter author looks for a CRUD-shaped method equivalent to `reserveBatch`
- **THEN** none exists — `reserveBatch` is an operation that combines lock acquisition, lease assignment, and row return atomically
- **AND** the spec documents why (`FOR UPDATE SKIP LOCKED` with lease semantics doesn't decompose into pure CRUD)

#### Scenario: Introspection reads return a message and its attempts

- **WHEN** a message has been inserted and attempted, and a caller invokes `getMessage(id)` then `attempts.latestForMessage(id)`
- **THEN** `getMessage` returns the stored message with its outbox `status` and payload
- **AND** the attempt read returns the recorded attempts for that message
- **AND** `listMessages({ tenantId })` returns a page whose `items` contains that message when scoped to its tenant

#### Scenario: Tenant reads return a record and a paginated page

- **WHEN** a tenant has been upserted, and a caller invokes `tenants.get(id)` then `tenants.list({ limit: 10 })`
- **THEN** `tenants.get` returns the tenant record
- **AND** `tenants.list` returns a page whose `items` contains that tenant and whose `nextCursor` is `null` when fewer than 10 tenants exist in the store

#### Scenario: Endpoint and message lists return paginated pages

- **WHEN** more endpoints (or messages) exist than fit in one page, and a caller invokes `endpoints.list({ limit })` (or `listMessages({ limit })`), then feeds each page's `nextCursor` back as `cursor`
- **THEN** every record is returned exactly once across the pages, newest-first
- **AND** the final page's `nextCursor` is `null`

#### Scenario: Keyset tie-break survives identical createdAt values

- **WHEN** several records share one `createdAt` (including ids differing only by letter case) and a caller pages across them with a `limit` smaller than the tied group
- **THEN** every record is returned exactly once across the pages — the `id` tie-break is a deterministic total order, so no row is skipped or repeated at the page boundary

#### Scenario: Reconcile returns a bounded page

- **WHEN** more undelivered messages match a reconcile filter than fit in one page, and a caller invokes `reconcile({ endpointId, since, limit })`, then feeds each page's `nextCursor` back as `cursor`
- **THEN** each call returns at most `limit` message ids, oldest-first
- **AND** every undelivered id is returned exactly once across the pages, with the final page's `nextCursor` `null`
