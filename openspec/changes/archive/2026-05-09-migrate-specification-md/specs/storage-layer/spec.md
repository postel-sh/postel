# Storage layer — delta spec

## ADDED Requirements

### Requirement: Postgres adapter is the primary backend

The library SHALL provide a Postgres storage adapter as the primary backend with the full feature set: row locks via `FOR UPDATE SKIP LOCKED`, JSONB columns, `RETURNING`, and `LISTEN`/`NOTIFY` for low-latency dispatch.

#### Scenario: Postgres adapter reads outbox

- **WHEN** the library is configured with the Postgres adapter and 100 messages are pending
- **THEN** workers reserve rows via `FOR UPDATE SKIP LOCKED` and dispatch them concurrently

### Requirement: SQLite adapter with feature parity except listen/notify

The library SHALL provide a SQLite storage adapter with feature parity to Postgres except no `LISTEN`/`NOTIFY` (polling fallback). Single-writer constraints MUST be documented.

#### Scenario: SQLite polling

- **WHEN** the library is configured with the SQLite adapter
- **THEN** workers poll the outbox at the configured interval and reserve rows via `BEGIN IMMEDIATE`

### Requirement: BYO storage interface

The library SHALL document a `Storage` interface (transactions, locks, queries) that users can implement to plug PlanetScale, CockroachDB, libSQL, Turso, or any other SQL backend. The interface MUST be stable across minor versions.

#### Scenario: Custom adapter

- **WHEN** a user implements the `Storage` interface and configures the library to use it
- **THEN** all sender / receiver / replay APIs work against the custom backend without library code changes

### Requirement: Migrations bundled in the library

Schema migrations SHALL be bundled in the library and runnable via both a CLI (`postel migrate`) and a programmatic API (`postel.migrate(db)`). Migrations MUST run idempotently — safe to invoke on every boot.

#### Scenario: Idempotent boot

- **WHEN** the host calls `postel.migrate(db)` on every process startup
- **THEN** subsequent runs after the first do nothing and complete in milliseconds

### Requirement: Tenant-scoped row-level access in queries

All library-issued queries SHALL include the `tenantId` filter when one is configured. This is defense in depth even though the host application is also responsible for tenancy enforcement.

#### Scenario: Tenant filter applied

- **WHEN** the library queries the messages table on behalf of tenant `t_42`
- **THEN** the SQL includes `WHERE tenant_id = 't_42'`

### Requirement: Schema is a fixed set of canonical tables

The DB schema SHALL include the tables `tenants`, `endpoints`, `endpoint_secrets`, `messages`, `attempts`, `endpoint_state_transitions`, plus a `dead_letter` view over `attempts`. The canonical DDL lives in `specs/db-schema/` and is the source of truth.

#### Scenario: Canonical DDL inspectable

- **WHEN** a contributor opens `specs/db-schema/0001_init.sql`
- **THEN** the file contains the full DDL for all six tables plus the dead_letter view
