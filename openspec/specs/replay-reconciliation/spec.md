# replay-reconciliation Specification

## Purpose

Replay-as-a-first-class-verb and reconciliation queries. Supports replaying a single message, a time-bounded range, or an arbitrary predicate; replays are tagged in the attempts audit trail (`replay_of` references the original `messages.id`) and may be throttled via a configurable replay throughput. Reconciliation surfaces messages that were never confirmed delivered for nightly catch-up jobs and admin tooling.
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

The library SHALL provide `postel.reconcile({ endpointId, since, limit?, cursor? })` returning a bounded page of messages that were never confirmed delivered (eligible for nightly catch-up jobs). The result is at most `limit` message ids (a conservative default limit applies when none is given), oldest-first, together with a `nextCursor` — `null` when the backlog is exhausted, otherwise an opaque token the caller passes back as `cursor` to resume where the previous page ended. A reconcile over an arbitrarily large gap SHALL therefore never materialize the entire backlog in one unbounded result.

#### Scenario: Reconcile finds gaps

- **WHEN** the host calls `reconcile({ endpointId, since })` after a receiver outage
- **THEN** the result's items list messages whose latest attempt is in a non-delivered state

#### Scenario: Reconcile pages through a large backlog

- **WHEN** the host calls `reconcile({ endpointId, since, limit })` over a backlog larger than `limit`, then feeds each page's `nextCursor` back as `cursor`
- **THEN** each call returns at most `limit` message ids, oldest-first
- **AND** every undelivered id is returned exactly once across the pages, with the final page's `nextCursor` `null`

### Requirement: Replay UI handler with dry run

The admin replay handler SHALL support time-range selection and a dry-run mode that returns the count of messages that would be re-enqueued without re-enqueueing them.

#### Scenario: Dry run returns count

- **WHEN** the admin handler is invoked with `{ since, until, dryRun: true }`
- **THEN** the response includes a count and no messages are re-enqueued

### Requirement: Replay safety contract

When a message is replayed, the host MUST choose explicitly between (a) issuing a fresh `webhook-id` for the replay attempt or (b) reusing the original `webhook-id`. The choice MUST be a required option on the replay API — no implicit default — because the two modes have different receiver-side implications (receivers with idempotency dedup keyed on `webhook-id` will treat the two modes differently).

#### Scenario: Replay with fresh id

- **WHEN** the host calls `replay(messageId, { freshWebhookId: true })`
- **THEN** the dispatched headers carry a new `webhook-id` distinct from the original
- **AND** the receiver-side dedup helper treats the replay as a new message

#### Scenario: Replay with reused id

- **WHEN** the host calls `replay(messageId, { freshWebhookId: false })`
- **THEN** the dispatched headers carry the original `webhook-id`
- **AND** receivers with idempotency dedup keyed on `webhook-id` will treat the replay as a duplicate (no side effects)

#### Scenario: Required choice — neither default

- **WHEN** the host calls `replay(messageId)` without specifying `freshWebhookId`
- **THEN** the call fails with a structured error indicating that the host must choose explicitly

### Requirement: Default replay throughput

When `replay()` is invoked over a range or predicate without an explicit throttle, the library SHALL apply a conservative default of **100 replay attempts per second per endpoint**. The default MUST be overridable per call via a `replayThroughput` option.

#### Scenario: Default throttle applied

- **WHEN** the host invokes `replay({ endpointId, since })` and matches 10,000 messages without specifying a throttle
- **THEN** replay attempts dispatch at no more than 100 per second to that endpoint

#### Scenario: Throttle overridden

- **WHEN** the host invokes `replay({ endpointId, since, replayThroughput: 500 })`
- **THEN** replay attempts dispatch at up to 500 per second to that endpoint

