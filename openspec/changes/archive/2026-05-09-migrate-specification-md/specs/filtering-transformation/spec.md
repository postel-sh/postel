# Filtering and transformation — delta spec

## ADDED Requirements

### Requirement: Type filter with glob support

Endpoints SHALL accept a `types` filter listing event types or glob patterns (`user.*`, `order.created`).

#### Scenario: Glob match

- **WHEN** an endpoint has `types: ['user.*']` and an event of type `user.created` is sent
- **THEN** the endpoint receives a delivery attempt

#### Scenario: Glob mismatch

- **WHEN** the same endpoint receives an event of type `order.created`
- **THEN** no delivery is attempted

### Requirement: Channel filter

Endpoints SHALL accept a `channels` filter that matches against the Standard Webhooks `channels` field on the event.

#### Scenario: Channel match

- **WHEN** an endpoint subscribes to channel `tenant_42`
- **THEN** events sent with `channels: ['tenant_42']` are delivered to that endpoint

### Requirement: Predicate filter

Endpoints SHALL accept a TypeScript predicate `(event) => boolean`. The predicate is code, not a DSL.

#### Scenario: Predicate accepts event

- **WHEN** an endpoint's predicate returns `true` for an event
- **THEN** the dispatcher proceeds with the delivery

### Requirement: Transform produces body to send

Endpoints SHALL accept a transform `(event) => bodyToSend | null | undefined`. A null/undefined return value SHALL skip delivery.

#### Scenario: Transform reshapes payload

- **WHEN** an endpoint's transform returns `{ id: event.id, summary: '...' }`
- **THEN** the outgoing HTTP body is the transform's return value

### Requirement: Filter and transform errors fail closed

Exceptions thrown inside a filter or transform SHALL be caught and logged. The attempt MUST be skipped (no delivery, no infinite retry); after the configured retries the message SHALL go to dead-letter.

#### Scenario: Transform throws

- **WHEN** an endpoint's transform throws on a given event
- **THEN** the dispatcher records the error, skips this attempt, and re-evaluates on the next retry; ultimately the message goes to dead-letter

### Requirement: Late binding at dispatch time

Filters and transforms SHALL be resolved per-attempt at dispatch time, not at send time. Endpoint configuration changes during the retry window MUST be honored.

#### Scenario: Change transform between retries

- **WHEN** a delivery fails its first attempt, the host updates the endpoint's transform, and the dispatcher schedules retry 2
- **THEN** retry 2 uses the updated transform
