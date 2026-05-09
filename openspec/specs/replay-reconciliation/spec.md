# replay-reconciliation Specification

## Purpose
TBD - created by archiving change migrate-specification-md. Update Purpose after archive.
## Requirements
### Requirement: Replay a single message

The library SHALL provide `postel.replay({ messageId })` to re-enqueue a single message for delivery.

#### Scenario: Replay one message

- **WHEN** the host calls `replay({ messageId: 'msg_123' })`
- **THEN** the message is re-enqueued and dispatch attempts resume

### Requirement: Replay a range

The library SHALL provide `postel.replay({ endpointId, since, until?, types? })` to re-enqueue a time-bounded range of messages, optionally narrowed by event types.

#### Scenario: Replay a 1-hour window

- **WHEN** the host calls `replay({ endpointId, since: '2026-05-09T10:00Z', until: '2026-05-09T11:00Z' })`
- **THEN** every message that would have matched the endpoint in that window is re-enqueued

### Requirement: Replay by predicate

The library SHALL provide `postel.replay({ filter: (msg) => boolean })` to re-enqueue messages by an arbitrary predicate.

#### Scenario: Replay by tenant

- **WHEN** the host calls `replay({ filter: (msg) => msg.tenantId === 't_42' })`
- **THEN** every message matching the predicate is re-enqueued

### Requirement: Replay attempts tagged for audit

Attempts produced by replay SHALL carry a `replay_of` field referencing the original message id. The audit trail MUST distinguish replay attempts from original attempts.

#### Scenario: Replay tag visible

- **WHEN** an attempts query lists attempts for a replayed message
- **THEN** the replay attempts have `replay_of` set to the original message id

### Requirement: Replay rate limiting

The library SHALL support a configurable max replay throughput (messages/sec) so a "replay everything" operation does not DDoS the receiver.

#### Scenario: Throttled replay

- **WHEN** the host invokes `replay({ endpointId, since })` with `replayThroughput: 100`
- **THEN** at most 100 replay attempts are dispatched per second to that endpoint

### Requirement: Reconciliation API

The library SHALL provide `postel.reconcile({ endpointId, since })` returning a list of messages that were never confirmed delivered (eligible for nightly catch-up jobs).

#### Scenario: Reconcile finds gaps

- **WHEN** the host calls `reconcile({ endpointId, since })` after a receiver outage
- **THEN** the result lists messages whose latest attempt is in a non-delivered state

### Requirement: Replay UI handler with dry run

The admin replay handler SHALL support time-range selection and a dry-run mode that returns the count of messages that would be re-enqueued without re-enqueueing them.

#### Scenario: Dry run returns count

- **WHEN** the admin handler is invoked with `{ since, until, dryRun: true }`
- **THEN** the response includes a count and no messages are re-enqueued

