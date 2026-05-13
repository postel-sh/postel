# storage-layer Specification

## Purpose

The shared, operation-shaped `Storage` interface every adapter implements, plus the adapter matrix that lets a host plug Postel against whatever DB access layer it already runs (standalone connections, raw clients, or query-builder / ORM instances). Covers the canonical Postgres / SQLite contract, host-transaction passthrough (the outbox-pattern enabler), migrations runnable from CLI and programmatic API, tenant-scoped row-level access, and optional adapter capabilities (`notify` / `subscribe`, `transactional`, `streaming`). The full strategy is in [ADR 0007](../../../decisions/0007-storage-strategy.md).
## Requirements
### Requirement: BYO storage interface

The library SHALL document and stabilize a `Storage` interface that every adapter — first-party and third-party — implements. The interface MUST be technology-agnostic (a third-party author MUST NOT need to import any library-internal SQL builder or ORM to implement it), operation-shaped (not CRUD-shaped), and stable across minor versions.

The operation set MUST include at minimum: `insertMessage`, `insertOrReuseByIdempotencyKey`, `reserveBatch`, `recordAttempt`, `releaseLease`, `expireStaleLeases`, `loadEndpointsForMessage`, `rangeQuery` (as a streaming iterable), `reconcile`, `dedup`, `transaction(cb)`, and endpoint / secrets / tenant sub-namespaces. `notify` and `subscribe` are optional capabilities (see `Optional storage capabilities` below).

#### Scenario: Custom adapter against an unsupported backend

- **WHEN** a user implements the `Storage` interface for libSQL / Turso / D1 / CockroachDB / PlanetScale or any other backend, and configures Postel to use it
- **THEN** all sender / receiver / replay APIs work against the custom backend without any library code changes
- **AND** the adapter passes the `@postel/compliance` test suite without modification

#### Scenario: Worker reservation can't be expressed as CRUD

- **WHEN** an adapter author looks for a CRUD-shaped method equivalent to `reserveBatch`
- **THEN** none exists — `reserveBatch` is an operation that combines lock acquisition, lease assignment, and row return atomically
- **AND** the spec documents why (`FOR UPDATE SKIP LOCKED` with lease semantics doesn't decompose into pure CRUD)

### Requirement: Tenant-scoped row-level access in queries

All library-issued queries SHALL include the `tenantId` filter when one is configured. This is defense in depth even though the host application is also responsible for tenancy enforcement.

#### Scenario: Tenant filter applied

- **WHEN** the library queries the messages table on behalf of tenant `t_42`
- **THEN** the SQL includes `WHERE tenant_id = 't_42'`

### Requirement: Schema is a fixed set of canonical tables

The DB schema SHALL include the tables `_postel_meta`, `tenants`, `endpoints`, `endpoint_secrets`, `messages`, `attempts`, and `endpoint_state_transitions`, plus a `dead_letter` view over `attempts`. `_postel_meta` records the schema version (read by the library at boot to refuse to run against an incompatible schema). The canonical DDL lives in [`specs/db-schema/0001_init.sql`](../../../specs/db-schema/0001_init.sql) and is the source of truth.

#### Scenario: Canonical DDL inspectable

- **WHEN** a contributor opens `specs/db-schema/0001_init.sql`
- **THEN** the file contains the full DDL for the seven canonical tables (`_postel_meta`, `tenants`, `endpoints`, `endpoint_secrets`, `messages`, `attempts`, `endpoint_state_transitions`) plus the `dead_letter` view

#### Scenario: Schema version handshake

- **WHEN** the library starts up against a database
- **THEN** it reads `_postel_meta.schema_version` and refuses to run if the value is incompatible with the library's expected schema version

### Requirement: Postgres support across the adapter matrix

The library SHALL provide Postgres support through multiple adapter packages across three categories — standalone, client-wrapping, and ORM-wrapping — so a host can wire Postel against whatever Postgres access layer they already use (or none). Every Postgres-targeting adapter MUST exercise the full feature surface: row locks via `FOR UPDATE SKIP LOCKED`, JSONB columns, `RETURNING`, and `LISTEN`/`NOTIFY` for low-latency dispatch.

#### Scenario: Standalone Postgres adapter reserves outbox rows

- **WHEN** the host configures Postel with `@postel/standalone-pg` and 100 messages are pending
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

- **WHEN** the host configures Postel with `@postel/standalone-sqlite`
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

1. **Standalone adapters** — Postel owns the connection. Zero-config "drop it in" packages for hosts who don't have a DB access layer yet (e.g., `@postel/standalone-pg`, `@postel/standalone-sqlite`).
2. **Client adapters** — the host hands Postel a raw client (e.g., a pg `Pool`, a `postgres()` instance, `better-sqlite3`). Packages: `@postel/pg`, `@postel/postgres-js`, `@postel/better-sqlite3`.
3. **Query-builder / ORM adapters** — the host hands Postel their query builder or ORM instance (Kysely `Kysely<DB>`, Drizzle `db`, Prisma `PrismaClient`). Packages: `@postel/kysely`, `@postel/drizzle`, `@postel/prisma`.

For Postel 1.0, the library MUST ship at least one adapter in each category for both Postgres and SQLite (where applicable). The complete Tier-1 set is listed in [ADR 0007 — Storage strategy](../../../decisions/0007-storage-strategy.md).

#### Scenario: Drop-in standalone usage

- **WHEN** a new host has no existing DB layer and installs `@postel/standalone-pg`
- **THEN** `createPostel({ adapter: postelStandalonePg({ connectionString }) })` is the entire setup
- **AND** Postel owns the connection pool and runs migrations on first boot

#### Scenario: Drizzle host wraps its own db

- **WHEN** an existing host already runs Drizzle and installs `@postel/drizzle`
- **THEN** `createPostel({ adapter: postelDrizzle(db) })` reuses the host's Drizzle instance
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

- **WHEN** an adapter targets a backend that doesn't expose real transactions (e.g., a hypothetical edge KV-backed dedup-only adapter)
- **THEN** the adapter's `transaction(cb)` MAY run the callback sequentially without true atomicity
- **AND** the adapter's `capabilities.transactional` MUST be `false`
- **AND** the documentation warns about the consequences

### Requirement: Optional storage capabilities

Each adapter SHALL declare a `capabilities` object at construction time describing which optional features it supports. The worker scheduler and dispatcher MUST consult `capabilities` and degrade gracefully when an optional feature is absent.

At minimum, `capabilities` includes: `notify` (boolean — does the adapter support `LISTEN`/`NOTIFY`-style push wakeups?), `subscribe` (boolean — same), `transactional` (boolean — does it support real transactions?), and `streaming` (boolean — does `rangeQuery` stream without buffering?).

#### Scenario: Polling fallback when notify is unavailable

- **WHEN** an adapter declares `capabilities.notify = false` (e.g., SQLite, libSQL, D1)
- **THEN** workers poll the outbox at the configured interval
- **AND** no calls to `notify` / `subscribe` are issued

#### Scenario: Native push when notify is available

- **WHEN** an adapter declares `capabilities.notify = true` (e.g., `@postel/standalone-pg`, `@postel/pg`)
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
- **AND** the package is importable from edge runtimes if needed

### Requirement: Memory and cache strategies [PORT-SPECIFIC]

Postel implementations SHALL treat the following as port-specific memory- and cache-resident state: JWKS cache eviction policy (TTL, LRU, refresh-on-`kid`-miss), in-memory dedup TTL backing data structure, secret-array layout in memory, retry-schedule timer wheel vs priority queue, and attempts-buffer pre-persistence shape. Ports MAY implement these freely as long as the observable behavior matches the CONTRACT-level requirements they support (wire output, persistence rows, and `Storage`-interface boundaries).

**Conformance**: **PORT-SPECIFIC**. None of the choices above influence the cross-port contract; compliance verifies the observable boundaries.

#### Scenario: Equivalent caching schemes yield identical observable behavior

- **WHEN** the TS reference impl uses an LRU-backed JWKS cache and the Go port uses a TTL-backed cache
- **THEN** both ports pass the JWKS compliance tests (key fetch, `kid` resolution, rotation handling)
- **AND** the choice of caching strategy is not part of the conformance contract

