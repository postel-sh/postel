## ADDED Requirements

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

## MODIFIED Requirements

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
