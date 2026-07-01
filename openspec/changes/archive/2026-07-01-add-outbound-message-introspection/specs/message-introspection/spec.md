## ADDED Requirements

### Requirement: Read a message by id

The library SHALL provide a read that returns a single outbound message by its `MessageId`. The returned message MUST carry the message metadata — event `type`, `tenantId`, `channels`, `version`, `createdAt`, `expiresAt`, outbox `status`, current `attemptNumber`, `scheduledFor` (retry-backoff time), `replayOf` (replay origin), and `idempotencyKey` — together with the original event payload (`data`). When no message matches the id, the read SHALL resolve to an absent result rather than throwing.

The outbox `status` reported here is the message-level lifecycle (`pending` / `dispatched` / `expired`); per-endpoint delivery outcomes are carried by the attempts (see *List a message's delivery attempts*).

#### Scenario: Get an existing message returns metadata and payload

- **WHEN** the host calls `outbound.messages.get(id)` for a message it previously sent
- **THEN** the result carries that message's `type`, `data`, `tenantId`, `createdAt`, and outbox `status`
- **AND** the `id` matches the requested id

#### Scenario: Get a missing message resolves absent

- **WHEN** the host calls `outbound.messages.get(id)` for an id that was never sent
- **THEN** the read resolves to an absent result (no message)
- **AND** it does not throw

### Requirement: List a message's delivery attempts

The library SHALL provide a read that returns the full delivery-attempt history for a message, ordered by `attemptNumber`. Each attempt MUST expose its delivery `status`, target `endpointId`, `responseCode`, `latencyMs`, `error`, the attempt timestamps (`scheduledFor` / `startedAt` / `completedAt`), and its `replayOf` tag. A message with no recorded attempts SHALL resolve to an empty list.

#### Scenario: Attempts are returned ordered with status, code, and latency

- **WHEN** a message has been attempted against an endpoint and the host calls `outbound.messages.attempts(id)`
- **THEN** the result lists the recorded attempts ordered by `attemptNumber`
- **AND** each attempt carries its `status`, `endpointId`, `responseCode`, and `latencyMs`

#### Scenario: Replay attempts carry the replay tag

- **WHEN** the host lists attempts for a message that was replayed with a fresh webhook id
- **THEN** the replay attempts have `replayOf` set to the original message id, distinguishing them from original attempts

#### Scenario: Unknown message yields an empty attempt list

- **WHEN** the host calls `outbound.messages.attempts(id)` for a message that has no recorded attempts (or does not exist)
- **THEN** the result is an empty list

### Requirement: List and filter messages

The library SHALL provide a read that lists outbound messages, filterable by `tenantId`, event `type`(s), outbox `status`, and a `createdAt` time window (`since` / `until`). Results SHALL be returned newest-first and bounded by a caller-supplied `limit`, with a conservative default limit applied when none is given. A tenant-scoped caller SHALL see only that tenant's messages.

#### Scenario: Filter by type and time window

- **WHEN** the host calls `outbound.messages.list({ types: ['order.created'], since })` over a store holding mixed types and timestamps
- **THEN** the result contains only `order.created` messages created at or after `since`
- **AND** the messages are ordered newest-first

#### Scenario: Filter by outbox status

- **WHEN** the host calls `outbound.messages.list({ status: 'dispatched' })`
- **THEN** the result contains only messages whose outbox `status` is `dispatched`

#### Scenario: Tenant scoping restricts results

- **WHEN** the host calls `outbound.messages.list({ tenantId: 't_42' })`
- **THEN** only messages whose `tenantId` is `t_42` are returned

#### Scenario: Limit bounds the result count

- **WHEN** the host calls `outbound.messages.list({ limit: 2 })` over a store holding more than two messages
- **THEN** at most two messages are returned
