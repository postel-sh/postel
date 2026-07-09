## MODIFIED Requirements

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
