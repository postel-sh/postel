# replay-reconciliation — delta spec

## ADDED Requirements

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
