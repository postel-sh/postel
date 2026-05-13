# receiver — delta spec

## MODIFIED Requirements

### Requirement: Idempotency dedup helper

The library SHALL provide `postel.dedup(messageId, { ttl })` returning `{ duplicate: boolean }` atomically (a second call within the TTL MUST return `{ duplicate: true }` even when the two calls race). First-party adapters MUST exist for **Postgres, SQLite, and in-memory**. An optional **Redis** adapter MAY be shipped for hosts that already run Redis — consistent with [ADR 0001 — Library shape](../../../decisions/0001-library-shape.md): Postel does NOT require Redis as a runtime dependency, but accommodates hosts that already have one.

#### Scenario: First receipt

- **WHEN** `dedup('msg_123', { ttl: '1h' })` is called for an unseen message id
- **THEN** the result is `{ duplicate: false }`
- **AND** the id is recorded for the TTL

#### Scenario: Duplicate receipt

- **WHEN** `dedup('msg_123', { ttl: '1h' })` is called twice within the TTL
- **THEN** the second call returns `{ duplicate: true }`

#### Scenario: Concurrent dedup calls

- **WHEN** two concurrent `dedup('msg_X')` calls arrive (no prior recording)
- **THEN** exactly one call returns `{ duplicate: false }`
- **AND** the other returns `{ duplicate: true }`

#### Scenario: Redis is opt-in only

- **WHEN** a host has NOT installed or configured the Redis dedup adapter
- **THEN** Postel runs without Redis as a dependency
- **AND** Postgres, SQLite, or in-memory dedup remains available
