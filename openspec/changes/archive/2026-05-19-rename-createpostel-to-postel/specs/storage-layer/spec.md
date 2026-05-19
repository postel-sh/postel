## MODIFIED Requirements

### Requirement: Adapter matrix with three categories

The library SHALL ship storage adapters across three categories so a host can pick the right integration shape for their stack:

1. **Standalone adapters** — Postel owns the connection. Zero-config "drop it in" packages for hosts who don't have a DB access layer yet (e.g., `@postel/standalone-pg`, `@postel/standalone-sqlite`).
2. **Client adapters** — the host hands Postel a raw client (e.g., a pg `Pool`, a `postgres()` instance, `better-sqlite3`). Packages: `@postel/pg`, `@postel/postgres-js`, `@postel/better-sqlite3`.
3. **Query-builder / ORM adapters** — the host hands Postel their query builder or ORM instance (Kysely `Kysely<DB>`, Drizzle `db`, Prisma `PrismaClient`). Packages: `@postel/kysely`, `@postel/drizzle`, `@postel/prisma`.

For Postel 1.0, the library MUST ship at least one adapter in each category for both Postgres and SQLite (where applicable). The complete Tier-1 set is listed in [ADR 0007 — Storage strategy](../../../decisions/0007-storage-strategy.md).

#### Scenario: Drop-in standalone usage

- **WHEN** a new host has no existing DB layer and installs `@postel/standalone-pg`
- **THEN** `Postel({ adapter: postelStandalonePg({ connectionString }) })` is the entire setup
- **AND** Postel owns the connection pool and runs migrations on first boot

#### Scenario: Drizzle host wraps its own db

- **WHEN** an existing host already runs Drizzle and installs `@postel/drizzle`
- **THEN** `Postel({ adapter: postelDrizzle(db) })` reuses the host's Drizzle instance
- **AND** Postel does NOT open its own connection or pool

#### Scenario: Adapter category declared in package metadata

- **WHEN** a contributor inspects an adapter's `package.json`
- **THEN** the package's category (standalone / client / orm) is declared in a `postel.adapter.category` field
- **AND** documentation surfaces the category prominently
