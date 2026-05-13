# storage-layer — delta spec

## MODIFIED Requirements

### Requirement: Host transaction passthrough

Every write operation on the `Storage` interface SHALL accept an optional `tx` parameter representing the host's transaction handle (the exact shape varies by adapter category). When provided, the adapter MUST execute the operation under the host's transaction rather than opening its own.

#### Scenario: Outbox insert participates in host transaction

- **WHEN** the host opens `db.transaction(async (tx) => { ... await postel.send({...}, { tx }); ... })`
- **THEN** Postel's outbox insert is executed against `tx`
- **AND** if the host transaction rolls back, the outbox row is rolled back atomically with the host's writes

#### Scenario: Adapter without real transaction support degrades gracefully

- **WHEN** an adapter targets a backend that doesn't expose real transactions (e.g., a hypothetical edge KV-backed dedup-only adapter)
- **THEN** the adapter's `transaction(cb)` MAY run the callback sequentially without true atomicity
- **AND** the adapter's `capabilities.transactional` MUST be `false`
- **AND** the documentation warns about the consequences

## ADDED Requirements

### Requirement: Worker lease lifecycle

When a worker reserves an outbox row via `reserveBatch`, the adapter SHALL stamp the row with `reserved_by` (a worker id), `reserved_at` (timestamp), and `lease_expires_at = reserved_at + leaseMs`. The default `leaseMs` is **60_000** (60 seconds). Workers MUST extend the lease before expiry while processing; on graceful completion they release it via `releaseLease`. On crash, the lease expires naturally and another worker reclaims the row via `expireStaleLeases`. A reclaimed row MUST NOT result in a lost message — at-least-once delivery (see `sender` `At-least-once delivery guarantee`) depends on this.

#### Scenario: Default lease duration

- **WHEN** a worker calls `reserveBatch({ workerId: 'w1', batchSize: 10 })` without specifying `leaseMs`
- **THEN** each reserved row has `lease_expires_at = reserved_at + 60_000ms`

#### Scenario: Lease reclaimed after worker crash

- **WHEN** a worker reserves a message and crashes without calling `releaseLease`
- **AND** the time since `lease_expires_at` exceeds the configured reclamation interval
- **THEN** a subsequent `expireStaleLeases(now)` call clears `reserved_by` / `reserved_at` / `lease_expires_at` on the row
- **AND** the row becomes available for reservation by another worker via `reserveBatch`

#### Scenario: Lease renewal during long-running attempt

- **WHEN** a worker is processing an attempt that will take longer than the lease duration
- **THEN** the worker MAY renew the lease before expiry (extending `lease_expires_at`)
- **AND** the row remains reserved while the renewal succeeds

### Requirement: Helpers package for adapter authors

A `@postel/storage-helpers` package (zero DB dependencies) SHALL export utilities every adapter would otherwise reimplement: timestamp normalization, retry-policy JSON serialization, idempotency-key formatting, capability-flag declarations, and message/attempt row encode/decode. This package is the equivalent of Better Auth's `transformInput` / `transformOutput` / `getFieldName` / `getModelName` helpers — the L1↔L2 glue that keeps each adapter small.

#### Scenario: Adapter author imports helpers

- **WHEN** an adapter author begins implementing the `Storage` interface for a new backend
- **THEN** they import `@postel/storage-helpers` for the standard utilities listed above
- **AND** they do not reimplement those utilities locally

#### Scenario: Helpers package has no DB dependency

- **WHEN** a consumer installs `@postel/storage-helpers`
- **THEN** no Postgres, SQLite, or other DB client is pulled in transitively
- **AND** the package is importable from edge runtimes if needed
