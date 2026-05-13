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

The library SHALL support automatic endpoint disabling on sustained failure. The canonical default threshold is **100% failure rate over a rolling 24-hour window, with a minimum of 50 attempts in that window** (the minimum-attempt floor prevents endpoints with one or two failing attempts from being prematurely disabled). The threshold MUST be configurable per endpoint. When triggered, the endpoint state moves to `disabled` and a row is appended to `endpoint_state_transitions` with `reason: 'auto-disable'`.

#### Scenario: Default threshold triggers auto-disable

- **WHEN** an endpoint has at least 50 attempts in the past 24 hours and 100% of them failed
- **THEN** its state transitions to `disabled`
- **AND** `endpoint_state_transitions` records the transition with `actor: 'system'` and `reason: 'auto-disable'`

#### Scenario: Below minimum-attempt floor

- **WHEN** an endpoint has 10 attempts in the past 24 hours all failing
- **THEN** the endpoint remains `active` (the 50-attempt floor is not met)

