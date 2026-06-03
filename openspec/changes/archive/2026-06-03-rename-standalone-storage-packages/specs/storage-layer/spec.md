## MODIFIED Requirements

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

### Requirement: Adapter matrix with three categories

The library SHALL ship storage adapters across three categories so a host can pick the right integration shape for their stack:

1. **Standalone adapters** — Postel owns the connection. Zero-config "drop it in" packages for hosts who don't have a DB access layer yet (e.g., `@postel/pg`, `@postel/sqlite`).
2. **Client adapters** — the host hands Postel a raw client (e.g., a pg `Pool`, a `postgres()` instance, `better-sqlite3`). Packages: `@postel/node-postgres`, `@postel/postgres-js`, `@postel/better-sqlite3`.
3. **Query-builder / ORM adapters** — the host hands Postel their query builder or ORM instance (Kysely `Kysely<DB>`, Drizzle `db`, Prisma `PrismaClient`). Packages: `@postel/kysely`, `@postel/drizzle`, `@postel/prisma`.

For Postel 1.0, the library MUST ship at least one adapter in each category for both Postgres and SQLite (where applicable). The complete Tier-1 set is listed in [ADR 0007 — Storage strategy](../../../decisions/0007-storage-strategy.md).

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

- **WHEN** an adapter declares `capabilities.notify = false` (e.g., SQLite, libSQL, D1)
- **THEN** workers poll the outbox at the configured interval
- **AND** no calls to `notify` / `subscribe` are issued

#### Scenario: Native push when notify is available

- **WHEN** an adapter declares `capabilities.notify = true` (e.g., `@postel/pg`, `@postel/node-postgres`)
- **THEN** workers `subscribe` to a channel and receive wakeups via `notify` from `send()` paths
- **AND** poll-fallback is not used
