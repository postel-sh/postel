# filtering-transformation Specification

## Purpose

Per-endpoint subscription filters and payload transformations applied at dispatch time. Filters narrow which events reach which endpoints (event type globs, Standard Webhooks channels, host-supplied predicates); transforms reshape the outgoing body. Filter and transform functions are evaluated per attempt with late binding (so endpoint changes during retry windows are honored) and fail closed on exceptions.
## Requirements
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

Endpoints SHALL accept a `filterFn` — a TypeScript predicate `(event: FilterEnvelope) => boolean`, where `FilterEnvelope` is `{ type, data, channels?, timestamp? }`. `filterFn` is code, not a DSL, and — like `transform` — is held in a process-local registry on non-memory storage: it is not admin-API-safe and does not survive a restart unless the host re-registers it. `filterFn` runs after the structural `filter` and only if that passed.

#### Scenario: Predicate accepts event

- **WHEN** an endpoint's `filterFn` returns `true` for an event
- **THEN** the dispatcher proceeds with the delivery

#### Scenario: Predicate receives a typed envelope

- **WHEN** an endpoint's `filterFn` runs
- **THEN** it receives `{ type, data, channels, timestamp }` — not `unknown` — so a TypeScript `filterFn` can narrow the envelope's shape without an `as` cast

### Requirement: Transform produces body to send

Endpoints SHALL accept a transform `(event) => bodyToSend | null | undefined`. A null/undefined return value SHALL skip delivery.

#### Scenario: Transform reshapes payload

- **WHEN** an endpoint's transform returns `{ id: event.id, summary: '...' }`
- **THEN** the outgoing HTTP body is the transform's return value

### Requirement: Filter and transform errors fail closed

Exceptions thrown inside `filterFn` or `transform` SHALL be caught and logged. The attempt MUST be skipped (no delivery, no infinite retry); after the configured retries the message SHALL go to dead-letter. The structural `filter` never throws — it is a pure data comparison, not code — so this requirement applies only to the two function-shaped fields.

#### Scenario: Transform throws

- **WHEN** an endpoint's transform throws on a given event
- **THEN** the dispatcher records the error, skips this attempt, and re-evaluates on the next retry; ultimately the message goes to dead-letter

#### Scenario: filterFn throws

- **WHEN** an endpoint's `filterFn` throws on a given event
- **THEN** the dispatcher records the error, skips this attempt (recorded as filtered, not delivered), and re-evaluates on the next retry

### Requirement: Late binding at dispatch time

Filters and transforms SHALL be resolved per-attempt at dispatch time, not at send time. Endpoint configuration changes during the retry window MUST be honored.

#### Scenario: Change transform between retries

- **WHEN** a delivery fails its first attempt, the host updates the endpoint's transform, and the dispatcher schedules retry 2
- **THEN** retry 2 uses the updated transform

### Requirement: Structural filter matches a data path

Endpoints SHALL accept a structural `filter`: a clause `{ dataPath, equals }` or an array of such clauses. `dataPath` is a dot-separated path into the event's `data` (e.g. `"order.region"`); `equals` is a JSON value. A clause matches when the value at `dataPath` deep-equals `equals`. An array of clauses SHALL be evaluated as AND — every clause must match. `filter` is JSON-serializable: it MUST be persisted for real (round-trips through storage and the admin HTTP API), unlike the code-side `filterFn` escape hatch.

`filter` composes with `types`/`channels`/`filterFn`: an event is delivered only when all configured checks pass.

#### Scenario: Single clause matches

- **WHEN** an endpoint has `filter: { dataPath: "region", equals: "eu" }` and an event is sent with `data: { region: "eu" }`
- **THEN** the endpoint receives a delivery attempt

#### Scenario: Single clause mismatches

- **WHEN** the same endpoint receives an event with `data: { region: "us" }`
- **THEN** no delivery is attempted

#### Scenario: Nested data path

- **WHEN** an endpoint has `filter: { dataPath: "order.status", equals: "paid" }` and an event is sent with `data: { order: { status: "paid" } }`
- **THEN** the endpoint receives a delivery attempt

#### Scenario: Array of clauses is ANDed

- **WHEN** an endpoint has `filter: [{ dataPath: "region", equals: "eu" }, { dataPath: "tier", equals: "gold" }]` and an event is sent with `data: { region: "eu", tier: "silver" }`
- **THEN** no delivery is attempted, because the second clause does not match

#### Scenario: Missing data path does not match

- **WHEN** an endpoint has `filter: { dataPath: "region", equals: "eu" }` and an event is sent with `data: {}` (no `region` key)
- **THEN** no delivery is attempted

#### Scenario: filter round-trips through the read shape

- **WHEN** the host creates an endpoint with `filter: { dataPath: "region", equals: "eu" }`
- **THEN** `endpoints.get`/`list` return that same `filter` value
- **AND** the value survives a process restart against a real (non-in-memory) storage adapter

