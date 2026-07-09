# storage-layer Specification

## Purpose

The shared, operation-shaped `Storage` interface every adapter implements, plus the adapter matrix that lets a host plug Postel against whatever DB access layer it already runs (standalone connections, raw clients, or query-builder / ORM instances). Covers the canonical Postgres / SQLite contract, host-transaction passthrough (the outbox-pattern enabler), migrations runnable from CLI and programmatic API, tenant-scoped row-level access, and optional adapter capabilities (`notify` / `subscribe`, `transactional`, `streaming`). The full strategy is in [ADR 0007](../../../decisions/0007-storage-strategy.md).
## Requirements
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

### Requirement: Tenant-scoped row-level access in queries

All library-issued queries SHALL include the `tenantId` filter when one is configured. This is defense in depth even though the host application is also responsible for tenancy enforcement.

#### Scenario: Tenant filter applied

- **WHEN** the library queries the messages table on behalf of tenant `t_42`
- **THEN** the SQL includes `WHERE tenant_id = 't_42'`

### Requirement: Schema is a fixed set of canonical tables

The DB schema SHALL include the tables `_postel_meta`, `tenants`, `endpoints`, `endpoint_secrets`, `messages`, `attempts`, and `endpoint_state_transitions`, plus a `dead_letter` view over `attempts`. `_postel_meta` records the schema version (read by the library at boot to refuse to run against an incompatible schema). The `messages` table SHALL additionally carry the dispatch-state columns `attempt_number`, `scheduled_for`, and `replay_of` that worker reservation, retry backoff, and replay tagging require. The `endpoints` table SHALL carry the delivery-config columns `allow_http`, `max_inflight`, `http`, `circuit_breaker`, and `auto_disable` that per-endpoint dispatch behavior requires, and a `filter` column persisting the structural filter (JSON; NULL when unset). The canonical DDL lives in [`specs/db-schema/`](../../../specs/db-schema/) as forward-only migrations (`0001_init.sql`, `0002_*`, `0003_*`, `0004_*`, `0005_*`, …) and is the source of truth.

#### Scenario: Canonical DDL inspectable

- **WHEN** a contributor opens `specs/db-schema/0001_init.sql`
- **THEN** the file contains the full DDL for the seven canonical tables (`_postel_meta`, `tenants`, `endpoints`, `endpoint_secrets`, `messages`, `attempts`, `endpoint_state_transitions`) plus the `dead_letter` view

#### Scenario: Schema version handshake

- **WHEN** the library starts up against a database
- **THEN** it reads `_postel_meta.schema_version` and refuses to run if the value is incompatible with the library's expected schema version

#### Scenario: messages carries dispatch-state columns

- **WHEN** a contributor inspects the canonical `messages` schema after all forward-only migrations are applied
- **THEN** the table includes `attempt_number` (the per-message reservation/dispatch attempt counter), `scheduled_for` (retry-backoff time; NULL means due now), and `replay_of` (replay-origin tag)
- **AND** these are exactly the columns `reserveBatch` reads back into a `ReservedMessage`

#### Scenario: endpoints carries delivery-config columns

- **WHEN** a contributor inspects the canonical `endpoints` schema after all forward-only migrations are applied
- **THEN** the table includes `allow_http`, `max_inflight`, `http`, `circuit_breaker`, and `auto_disable`
- **AND** these are exactly the per-endpoint delivery-config fields `endpoints.create` / `endpoints.update` persist on an `EndpointRecord`

#### Scenario: endpoints carries the structural filter column

- **WHEN** a contributor inspects the canonical `endpoints` schema after all forward-only migrations are applied
- **THEN** the table includes a `filter` column
- **AND** it round-trips the structural filter `EndpointRecord.filter` persists — unlike `filterFn` and `transform`, which are code-side and never written to this column

### Requirement: Postgres support across the adapter matrix

The library SHALL provide Postgres support through multiple adapter packages across three categories — standalone, client-wrapping, and ORM-wrapping — so a host can wire Postel against whatever Postgres access layer they already use (or none). Every Postgres-targeting adapter MUST exercise the full feature surface: row locks via `FOR UPDATE SKIP LOCKED`, JSONB columns, `RETURNING`, and `LISTEN`/`NOTIFY` for low-latency dispatch.

#### Scenario: Standalone Postgres adapter reserves outbox rows

- **WHEN** the host configures Postel with `@postel/pg` and 100 messages are pending
- **THEN** workers reserve rows via `FOR UPDATE SKIP LOCKED` and dispatch them concurrently
- **AND** new messages inserted via `send()` wake idle workers via `LISTEN`/`NOTIFY`

#### Scenario: Drizzle ORM adapter shares the host's Postgres pool

- **WHEN** the host configures Postel with `@postel/drizzle` against a Drizzle Postgres instance
- **THEN** Postel issues its queries through the same Drizzle / pool the host uses
- **AND** no separate Postgres connection or pool is opened by Postel

### Requirement: SQLite support across the adapter matrix

The library SHALL provide SQLite support through multiple adapter packages across the adapter matrix (standalone, client-wrapping, ORM-wrapping). Feature parity with Postgres MUST be honored except for `LISTEN`/`NOTIFY`, where SQLite-targeting adapters fall back to polling. Single-writer constraints MUST be documented in each SQLite adapter's README.

**Conformance**: the polling-as-fallback-when-`notify`-unavailable behavior is **CONTRACT**. The specific **polling cadence default** is **PORT-SPECIFIC**: the TS reference implementation uses 100 ms by default with `BEGIN IMMEDIATE` reservation; ports MAY choose a different default appropriate to their runtime as long as worker reservation correctness is preserved.

#### Scenario: Standalone SQLite adapter polls

- **WHEN** the host configures Postel with `@postel/sqlite`
- **THEN** workers poll the outbox at the configured interval and reserve rows via `BEGIN IMMEDIATE`

#### Scenario: Drizzle SQLite adapter

- **WHEN** the host configures Postel with `@postel/drizzle` against a Drizzle SQLite instance
- **THEN** Postel issues its queries through the host's Drizzle / sqlite client and falls back to polling for dispatch wakeup

### Requirement: Migrations runnable from CLI and programmatic API

Schema migrations SHALL be deliverable per adapter category and runnable both via a CLI (`mise run postel:migrate` or equivalent) and programmatically (`postel.migrate(db)` or its adapter-specific equivalent). Migrations MUST be idempotent — safe to invoke on every boot.

- **Standalone and client adapters** ship raw SQL migration files (sourced from `specs/db-schema/`) and run them through the host's connection.
- **ORM adapters** ship schema fragments in the host's DSL (e.g., `@postel/drizzle/schema` exports a Drizzle schema; `@postel/prisma` ships a `.prisma` fragment). The host merges the fragment into their own schema and runs migrations through the ORM's native migration tooling.

#### Scenario: Idempotent standalone boot

- **WHEN** the host calls `postel.migrate(db)` on every process startup
- **THEN** subsequent runs after the first do nothing and complete in milliseconds

#### Scenario: ORM schema generation

- **WHEN** the host runs the adapter-specific schema generator (e.g., a `postel schema generate drizzle` CLI command)
- **THEN** the command emits a Drizzle schema fragment the host imports and merges into their own schema definition

### Requirement: Adapter matrix with three categories

The library SHALL ship storage adapters across three categories so a host can pick the right integration shape for their stack:

1. **Standalone adapters** — Postel owns the connection. Zero-config "drop it in" packages for hosts who don't have a DB access layer yet (e.g., `@postel/pg`, `@postel/sqlite`, `@postel/mysql`).
2. **Client adapters** — the host hands Postel a raw client (e.g., a pg `Pool`, a `postgres()` instance, `better-sqlite3`). Packages: `@postel/node-postgres`, `@postel/postgres-js`, `@postel/better-sqlite3`.
3. **Query-builder / ORM adapters** — the host hands Postel their query builder or ORM instance (Kysely `Kysely<DB>`, Drizzle `db`, Prisma `PrismaClient`, TypeORM `DataSource`, MikroORM `EntityManager`). Packages: `@postel/kysely`, `@postel/drizzle`, `@postel/prisma`, `@postel/typeorm`, `@postel/mikro-orm`.

For Postel 1.0, the library MUST ship at least one adapter in each category for Postgres, SQLite, and MySQL (where applicable). The complete Tier-1 set is listed in [ADR 0007 — Storage strategy](../../../decisions/0007-storage-strategy.md).

#### Scenario: Drop-in standalone usage

- **WHEN** a new host has no existing DB layer and installs `@postel/pg`
- **THEN** `Postel({ adapter: postelPg({ connectionString }) })` is the entire setup
- **AND** Postel owns the connection pool and runs migrations on first boot

#### Scenario: Drizzle host wraps its own db

- **WHEN** an existing host already runs Drizzle and installs `@postel/drizzle`
- **THEN** `Postel({ adapter: postelDrizzle(db) })` reuses the host's Drizzle instance
- **AND** Postel does NOT open its own connection or pool

#### Scenario: Adapter category declared in package metadata

- **WHEN** a contributor inspects an adapter's `package.json`
- **THEN** the package's category (standalone / client / orm) is declared in a `postel.adapter.category` field
- **AND** documentation surfaces the category prominently

### Requirement: Host transaction passthrough

Every write operation on the `Storage` interface SHALL accept an optional `tx` parameter representing the host's transaction handle (the exact shape varies by adapter category). When provided, the adapter MUST execute the operation under the host's transaction rather than opening its own.

#### Scenario: Outbox insert participates in host transaction

- **WHEN** the host opens `db.transaction(async (tx) => { ... await postel.send({...}, { tx }); ... })`
- **THEN** Postel's outbox insert is executed against `tx`
- **AND** if the host transaction rolls back, the outbox row is rolled back atomically with the host's writes

#### Scenario: Adapter without real transaction support degrades gracefully

- **WHEN** an adapter targets a backend that doesn't expose real transactions (e.g., a hypothetical KV-backed dedup-only adapter)
- **THEN** the adapter's `transaction(cb)` MAY run the callback sequentially without true atomicity
- **AND** the adapter's `capabilities.transactional` MUST be `false`
- **AND** the documentation warns about the consequences

### Requirement: Optional storage capabilities

Each adapter SHALL declare a `capabilities` object at construction time describing which optional features it supports. The worker scheduler and dispatcher MUST consult `capabilities` and degrade gracefully when an optional feature is absent.

At minimum, `capabilities` includes: `notify` (boolean — does the adapter support `LISTEN`/`NOTIFY`-style push wakeups?), `subscribe` (boolean — same), `transactional` (boolean — does it support real transactions?), and `streaming` (boolean — does `rangeQuery` stream without buffering?).

#### Scenario: Polling fallback when notify is unavailable

- **WHEN** an adapter declares `capabilities.notify = false` (e.g., SQLite, MySQL, libSQL, D1)
- **THEN** workers poll the outbox at the configured interval
- **AND** no calls to `notify` / `subscribe` are issued

#### Scenario: Native push when notify is available

- **WHEN** an adapter declares `capabilities.notify = true` (e.g., `@postel/pg`, `@postel/node-postgres`)
- **THEN** workers `subscribe` to a channel and receive wakeups via `notify` from `send()` paths
- **AND** poll-fallback is not used

### Requirement: Worker lease lifecycle

When a worker reserves an outbox row via `reserveBatch`, the adapter SHALL stamp the row with `reserved_by` (a worker id), `reserved_at` (timestamp), and `lease_expires_at = reserved_at + leaseMs`. The default `leaseMs` is **60_000** (60 seconds). Workers MUST extend the lease before expiry while processing; on graceful completion they release it via `releaseLease`. On crash, the lease expires naturally and another worker reclaims the row via `expireStaleLeases`. A reclaimed row MUST NOT result in a lost message — at-least-once delivery (see `sender` `At-least-once delivery guarantee`) depends on this.

**Conformance**: the default lease duration (60_000 ms), expiry semantics, and reclamation-via-`expireStaleLeases` are **CONTRACT**. The **renewal cadence within the lease window** is **PORT-SPECIFIC**: ports MAY renew on a fixed interval, on a per-attempt heartbeat, or eagerly at the start of long-running operations. The only CONTRACT-level renewal constraint is that a renewal MUST complete before `lease_expires_at` to retain the reservation.

#### Scenario: Default lease duration

- **WHEN** a worker calls `reserveBatch({ workerId: 'w1', batchSize: 10 })` without specifying `leaseMs`
- **THEN** each reserved row has `lease_expires_at = reserved_at + 60_000ms`

#### Scenario: Lease reclaimed after worker crash

- **WHEN** a worker reserves a message and crashes without calling `releaseLease`
- **AND** the time since `lease_expires_at` exceeds the configured reclamation interval
- **THEN** a subsequent `expireStaleLeases(now)` call clears `reserved_by` / `reserved_at` / `lease_expires_at` on the row
- **AND** the row becomes available for reservation by another worker via `reserveBatch`

#### Scenario: Lease renewal during long-running attempt

- **WHEN** a worker is processing an attempt that will take longer than the lease duration
- **THEN** the worker MAY renew the lease before expiry (extending `lease_expires_at`)
- **AND** the row remains reserved while the renewal succeeds

### Requirement: Helpers package for adapter authors

A `@postel/storage-helpers` package (zero DB dependencies) SHALL export utilities every adapter would otherwise reimplement: timestamp normalization, retry-policy JSON serialization, idempotency-key formatting, capability-flag declarations, and message/attempt row encode/decode. This package is the equivalent of Better Auth's `transformInput` / `transformOutput` / `getFieldName` / `getModelName` helpers — the L1↔L2 glue that keeps each adapter small.

#### Scenario: Adapter author imports helpers

- **WHEN** an adapter author begins implementing the `Storage` interface for a new backend
- **THEN** they import `@postel/storage-helpers` for the standard utilities listed above
- **AND** they do not reimplement those utilities locally

#### Scenario: Helpers package has no DB dependency

- **WHEN** a consumer installs `@postel/storage-helpers`
- **THEN** no Postgres, SQLite, or other DB client is pulled in transitively

### Requirement: Memory and cache strategies [PORT-SPECIFIC]

Postel implementations SHALL treat the following as port-specific memory- and cache-resident state: JWKS cache eviction policy (TTL, LRU, refresh-on-`kid`-miss), in-memory dedup TTL backing data structure, secret-array layout in memory, retry-schedule timer wheel vs priority queue, and attempts-buffer pre-persistence shape. Ports MAY implement these freely as long as the observable behavior matches the CONTRACT-level requirements they support (wire output, persistence rows, and `Storage`-interface boundaries).

**Conformance**: **PORT-SPECIFIC**. None of the choices above influence the cross-port contract; compliance verifies the observable boundaries.

#### Scenario: Equivalent caching schemes yield identical observable behavior

- **WHEN** the TS reference impl uses an LRU-backed JWKS cache and the Go port uses a TTL-backed cache
- **THEN** both ports pass the JWKS compliance tests (key fetch, `kid` resolution, rotation handling)
- **AND** the choice of caching strategy is not part of the conformance contract

### Requirement: MySQL support across the adapter matrix

The library SHALL provide MySQL support across the adapter matrix — a standalone adapter (`@postel/mysql`, where Postel owns a `mysql2` pool) and the query-builder / ORM adapters (`@postel/drizzle`, `@postel/kysely`, `@postel/prisma`, `@postel/typeorm`, `@postel/mikro-orm`) configured for their MySQL dialect. Feature parity with Postgres MUST be honored except for `LISTEN`/`NOTIFY`: MySQL-targeting adapters declare `capabilities.notify = false` and the worker scheduler falls back to polling. Worker reservation MUST use `FOR UPDATE SKIP LOCKED` (MySQL ≥ 8.0.1); because MySQL has no `RETURNING`, the reservation is performed as a select-then-update within a single transaction. All MySQL-targeting adapters MUST share one canonical MySQL schema (shipped from `@postel/storage-helpers`) so a host can move between them on the same database. The minimum MySQL version and any single-connection constraints MUST be documented in each MySQL adapter's README.

**Conformance**: worker-reservation correctness (lock + lease + return with no double-dispatch) and the polling-as-fallback-when-`notify`-unavailable behavior are **CONTRACT** — verified by `@postel/compliance` and the shared storage battery. The **mechanism** is **PORT-SPECIFIC**: the driver (`mysql2`), the select-then-update reservation shape, the canonical-schema column-type translation (timestamps stored as `BIGINT` epoch-milliseconds, `JSON` columns, `VARCHAR` keys), and the npm package names are reference-implementation choices a port MAY vary as long as the observable contract holds.

#### Scenario: Standalone MySQL adapter reserves outbox rows

- **WHEN** the host configures Postel with `@postel/mysql` and messages are pending
- **THEN** workers reserve rows via `FOR UPDATE SKIP LOCKED` (select-then-update, since MySQL has no `RETURNING`) and dispatch them concurrently, each message reserved exactly once
- **AND** because MySQL has no `LISTEN`/`NOTIFY`, `capabilities.notify` is `false` and idle workers poll the outbox

#### Scenario: MySQL through an ORM adapter shares the host's pool

- **WHEN** the host configures Postel with an ORM adapter in its MySQL dialect (e.g. `DrizzleStorage({ db, dialect: "mysql" })` or `TypeOrmStorage({ dataSource, dialect: "mysql" })`)
- **THEN** Postel issues its queries through the host's existing MySQL connection / pool
- **AND** no separate MySQL connection or pool is opened by Postel

