## MODIFIED Requirements

### Requirement: Migrations runnable from CLI and programmatic API

Schema migrations SHALL be deliverable per adapter category and runnable both via a CLI (`postel migrate` — see the `cli` capability spec — or `mise run postel:migrate` in this repo's own dev loop) and programmatically (`postel.migrate(db)` or its adapter-specific equivalent). Migrations MUST be idempotent — safe to invoke on every boot.

- **Standalone and client adapters** ship raw SQL migration files (sourced from `specs/db-schema/`) and run them through the host's connection. `postel migrate` drives this path for the standalone adapters (`@postel/pg`, `@postel/sqlite`, `@postel/mysql`).
- **ORM adapters** ship schema fragments in the host's DSL (e.g., `@postel/drizzle/schema` exports a Drizzle schema; `@postel/prisma` ships a `.prisma` fragment). The host merges the fragment into their own schema and runs migrations through the ORM's native migration tooling. This is a static export, not a CLI-driven generator step.

#### Scenario: Idempotent standalone boot

- **WHEN** the host calls `postel.migrate(db)` on every process startup
- **THEN** subsequent runs after the first do nothing and complete in milliseconds

#### Scenario: ORM schema generation

- **WHEN** the host imports `@postel/drizzle/schema`
- **THEN** the module exports Drizzle table definitions (per dialect) for the canonical schema
- **AND** the host merges them into their own schema definition and migrates with their ORM's native tooling, with no CLI command involved
