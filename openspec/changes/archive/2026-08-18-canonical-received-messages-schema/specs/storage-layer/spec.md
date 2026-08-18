## MODIFIED Requirements

### Requirement: Schema is a fixed set of canonical tables

The DB schema SHALL include the tables `_postel_meta`, `tenants`, `endpoints`, `endpoint_secrets`, `messages`, `attempts`, `endpoint_state_transitions`, and `postel_received_messages`, plus a `dead_letter` view over `attempts`. `_postel_meta` records the schema version (read by the library at boot to refuse to run against an incompatible schema). The `messages` table SHALL additionally carry the dispatch-state columns `attempt_number`, `scheduled_for`, and `replay_of` that worker reservation, retry backoff, and replay tagging require. The `endpoints` table SHALL carry the delivery-config columns `allow_http`, `max_inflight`, `http`, `circuit_breaker`, and `auto_disable` that per-endpoint dispatch behavior requires, and a `filter` column persisting the structural filter (JSON; NULL when unset). `postel_received_messages` is the receiver-side idempotency dedup table (`message_id` primary key, `expires_at` not null); unlike every other table here it carries no `tenant_id` — message ids are deduplicated in a single global namespace. The canonical DDL lives in [`specs/db-schema/`](../../../specs/db-schema/) as forward-only migrations (`0001_init.sql`, `0002_*`, `0003_*`, `0004_*`, `0005_*`, `0006_*`, `0007_*`, …) and is the source of truth.

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

#### Scenario: postel_received_messages is the canonical receiver-side dedup table

- **WHEN** a contributor inspects the canonical `postel_received_messages` schema (`specs/db-schema/0007_received_messages_dedup_table.sql`)
- **THEN** the table has exactly `message_id` (primary key) and `expires_at` (not null)
- **AND** every first-party dedup adapter (in-memory, Postgres, SQLite, MySQL) converges on this shape
