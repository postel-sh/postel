# sender — delta spec

## MODIFIED Requirements

### Requirement: At-least-once delivery guarantee

The sender SHALL guarantee at-least-once delivery. The contract MUST be documented and verified by tests. Duplicate delivery is acceptable; lost delivery is not. Crash recovery relies on the worker lease lifecycle owned by `storage-layer` (see `Worker lease lifecycle`): expired leases SHALL be reclaimable by another worker so a crashed worker never strands a message permanently.

#### Scenario: Worker crash mid-attempt

- **WHEN** a worker reserves a message and crashes before recording the attempt outcome
- **THEN** the lease (per `storage-layer` `Worker lease lifecycle`) expires and another worker reclaims the message via `expireStaleLeases`
- **AND** the message is eventually delivered

## REMOVED Requirements

### Requirement: Outbox writes are part of the host transaction

**Reason**: Duplicate of `Send participates in the host transaction (outbox pattern)` (line 17 of the main sender spec). Both requirements assert the same property with similar scenarios.
**Migration**: The retained requirement is `Send participates in the host transaction (outbox pattern)`. No behavioral change.

### Requirement: Per-endpoint payload transformation

**Reason**: Overlaps with `filtering-transformation` `Transform produces body to send`, with subtle divergence (sender's transform signature is `(event) => bodyToSend`; filtering-transformation's is `(event) => bodyToSend | null | undefined`). One canonical home avoids drift.
**Migration**: The transform contract is owned by `filtering-transformation` going forward. `sender` retains the outcome-status name `skipped` (recorded in `attempts.status` when the transform returns null/undefined) via the existing `Attempt status enum casing` requirement.

### Requirement: Per-endpoint payload filter

**Reason**: Overlaps with `filtering-transformation` `Predicate filter`. Same one-canonical-home reasoning.
**Migration**: The predicate-filter contract is owned by `filtering-transformation` going forward. `sender` retains the outcome-status name `filtered` (recorded in `attempts.status` when the predicate returns `false`) via the existing `Attempt status enum casing` requirement.
