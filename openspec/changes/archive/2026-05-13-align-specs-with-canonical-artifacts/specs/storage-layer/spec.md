# storage-layer — delta spec

## MODIFIED Requirements

### Requirement: Schema is a fixed set of canonical tables

The DB schema SHALL include the tables `_postel_meta`, `tenants`, `endpoints`, `endpoint_secrets`, `messages`, `attempts`, and `endpoint_state_transitions`, plus a `dead_letter` view over `attempts`. `_postel_meta` records the schema version (read by the library at boot to refuse to run against an incompatible schema). The canonical DDL lives in [`specs/db-schema/0001_init.sql`](../../../specs/db-schema/0001_init.sql) and is the source of truth.

#### Scenario: Canonical DDL inspectable

- **WHEN** a contributor opens `specs/db-schema/0001_init.sql`
- **THEN** the file contains the full DDL for the seven canonical tables (`_postel_meta`, `tenants`, `endpoints`, `endpoint_secrets`, `messages`, `attempts`, `endpoint_state_transitions`) plus the `dead_letter` view

#### Scenario: Schema version handshake

- **WHEN** the library starts up against a database
- **THEN** it reads `_postel_meta.schema_version` and refuses to run if the value is incompatible with the library's expected schema version
