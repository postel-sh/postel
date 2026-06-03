## MODIFIED Requirements

### Requirement: Schema is a fixed set of canonical tables

The DB schema SHALL include the tables `_postel_meta`, `tenants`, `endpoints`, `endpoint_secrets`, `messages`, `attempts`, and `endpoint_state_transitions`, plus a `dead_letter` view over `attempts`. `_postel_meta` records the schema version (read by the library at boot to refuse to run against an incompatible schema). The `messages` table SHALL additionally carry the dispatch-state columns `attempt_number`, `scheduled_for`, and `replay_of` that worker reservation, retry backoff, and replay tagging require. The canonical DDL lives in [`specs/db-schema/`](../../../specs/db-schema/) as forward-only migrations (`0001_init.sql`, `0002_*`, `0003_*`, …) and is the source of truth.

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
