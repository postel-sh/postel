# storage-layer — delta spec

## REMOVED Requirements

### Requirement: Postgres adapter is the primary backend

**Reason**: The "single primary Postgres adapter" framing is replaced by an adapter matrix (standalone / client / ORM). Postgres support now lives across multiple packages, with the host's existing DB access layer as the execution context. See [ADR 0007 — Storage strategy](../../../decisions/0007-storage-strategy.md).
**Migration**: Use any of the Postgres-targeting adapters from the matrix — `@postel/standalone-pg` (Postel owns the pool), `@postel/pg` / `@postel/postgres-js` (host hands a client), or `@postel/drizzle` / `@postel/prisma` / `@postel/kysely` (host hands a query builder / ORM instance). All exercise the same `FOR UPDATE SKIP LOCKED` + `LISTEN`/`NOTIFY` behavior; the new `Postgres support across the adapter matrix` requirement consolidates the contract.

### Requirement: SQLite adapter with feature parity except listen/notify

**Reason**: Same as above — the "single SQLite adapter" framing is replaced by the adapter matrix. SQLite support is delivered via multiple packages.
**Migration**: Use any of the SQLite-targeting adapters from the matrix (`@postel/standalone-sqlite`, `@postel/better-sqlite3`, the SQLite-mode of `@postel/drizzle` / `@postel/kysely`). The new `SQLite support across the adapter matrix` requirement consolidates the contract; feature parity with Postgres still excludes `LISTEN`/`NOTIFY` (polling fallback).

### Requirement: Migrations bundled in the library

**Reason**: The original requirement assumed one delivery path (raw SQL migrations). The adapter matrix needs two delivery paths: raw SQL for standalone / client adapters and ORM-native schema fragments for query-builder / ORM adapters.
**Migration**: The replacement requirement (`Migrations runnable from CLI and programmatic API`, ADDED below) covers both delivery paths.

## MODIFIED Requirements

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

## ADDED Requirements

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

#### Scenario: Helpers package exports adapter-author utilities

- **WHEN** an adapter author implements `Storage`
- **THEN** they import `@postel/storage-helpers` for timestamp normalization, retry-policy JSON serialization, idempotency-key formatting, and row encode / decode
- **AND** they do not need to reimplement these utilities

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
