# retry-policy Specification

## Purpose

Retry scheduling and failure handling for outbound deliveries. Specifies the default exponential-backoff schedule with jitter, programmable per-endpoint overrides, HTTP status-code-aware behavior (Retry-After honored, 4xx non-retryable except 408/429), per-endpoint circuit-breaker suspension, dead-letter on exhaustion, and configurable auto-disable thresholds.

## Requirements
### Requirement: Default retry schedule with jitter

The default retry policy SHALL use exponential backoff with jitter and the schedule `[5s, 5min, 30min, 2h, 5h, 10h, 1d, 2d, 3d]` (Standard Webhooks recommendation).

#### Scenario: Default schedule

- **WHEN** an endpoint with no override has a delivery fail
- **THEN** retries are scheduled at the listed intervals (with jitter applied)

### Requirement: Programmable per-endpoint retry policy

Each endpoint MAY override the policy via `retryPolicy({ schedule, jitter, maxAttempts })`. Schedule entries MUST accept duration strings.

#### Scenario: Custom schedule

- **WHEN** an endpoint specifies `retryPolicy({ schedule: ['1m', '5m', '30m', '2h', '24h'], jitter: 0.2, maxAttempts: 12 })`
- **THEN** the dispatcher uses that schedule for that endpoint

### Requirement: Status-code-aware retry

The dispatcher SHALL never retry on 4xx responses except 408 and 429. It SHALL always retry on 5xx and network errors. It MUST honor `Retry-After` headers when present.

#### Scenario: 400 not retried

- **WHEN** the receiver responds 400 Bad Request
- **THEN** the attempt is marked `failed-permanent` and not retried

#### Scenario: 429 with Retry-After

- **WHEN** the receiver responds 429 with `Retry-After: 30`
- **THEN** the next retry is scheduled at least 30 seconds later (subject to jitter)

### Requirement: Per-endpoint circuit breaker

After K consecutive failures, the dispatcher SHALL suspend deliveries to that endpoint for a cooldown window. K and the cooldown window MUST be configurable per endpoint. Other endpoints MUST be unaffected.

#### Scenario: Open circuit

- **WHEN** an endpoint has 10 consecutive failed attempts and circuit threshold is 10
- **THEN** the circuit opens, no further attempts are scheduled until the cooldown elapses
- **AND** other endpoints continue dispatch normally

### Requirement: Dead-letter event

After all retries are exhausted, the attempt SHALL be marked `dead-letter` and the library MUST emit an event subscribers can hook on (`postel.on('dead-letter', handler)`).

#### Scenario: Dead-letter handler invoked

- **WHEN** an attempt exhausts the retry schedule and remains failed
- **THEN** subscribers to `dead-letter` receive the message id, endpoint id, and final error

### Requirement: Endpoint auto-disable

The library SHALL support a configurable auto-disable threshold (e.g., 100% failures over 24h). When triggered, the endpoint state moves to `disabled` and a state transition is recorded.

#### Scenario: 100%-failure window triggers disable

- **WHEN** an endpoint has >50 attempts in a 24h window all failing
- **THEN** its state transitions to `disabled` with `reason: auto-disable`

### Requirement: Replay safety contract

When a message is replayed, the host MUST be able to choose between using a fresh `webhook-id` or reusing the original. The choice MUST be explicit (no implicit default that surprises receivers).

#### Scenario: Replay with fresh id

- **WHEN** the host calls `replay(messageId, { freshWebhookId: true })`
- **THEN** the dispatched headers carry a new `webhook-id` distinct from the original

