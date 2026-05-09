# sender Specification

## Purpose
TBD - created by archiving change migrate-specification-md. Update Purpose after archive.
## Requirements
### Requirement: Send is non-blocking and returns a MessageId

The library SHALL expose a public sender entry point of the form `postel.send({ type, data, channels?, idempotencyKey?, version? })` that synchronously persists the event into the outbox and returns a `MessageId`. The call MUST NOT block on network I/O to the receiver.

#### Scenario: Successful enqueue

- **WHEN** the host calls `postel.send({ type: 'order.created', data: {...} })`
- **THEN** the library inserts the event into the outbox in a single SQL statement and returns a `MessageId`
- **AND** no HTTP request to any receiver is made on this code path

### Requirement: Send participates in the host transaction (outbox pattern)

The sender SHALL accept an optional database transaction handle (e.g., `db`) so the outbox insert can be wrapped in the host's business transaction. The library MUST NOT open a separate connection or fire-and-forget when a transaction is provided.

#### Scenario: Atomic with host write

- **WHEN** the host opens a transaction, performs business writes, calls `postel.send({...}, { db: tx })`, and rolls the transaction back
- **THEN** the outbox row is rolled back together with the host writes
- **AND** no delivery attempt occurs

### Requirement: Idempotent send by client-supplied key

When `idempotencyKey` is provided, a duplicate `send()` SHALL return the existing `MessageId` without inserting a new row or scheduling a duplicate delivery.

#### Scenario: Repeat send with same key

- **WHEN** `postel.send({...}, { idempotencyKey: 'abc' })` is called twice with identical arguments
- **THEN** both calls return the same `MessageId`
- **AND** the outbox contains exactly one row for that key

### Requirement: Late-binding fanout

A single `send()` SHALL resolve to N delivery attempts, one per matching endpoint, with the matching computed at dispatch time (not send time). Endpoint configuration changes during retry windows MUST be honored.

#### Scenario: Endpoint added between send and dispatch

- **WHEN** `send()` runs, then a new matching endpoint is created, then the dispatcher picks up the message
- **THEN** the new endpoint receives a delivery attempt for that message

### Requirement: Workers drain the outbox safely under concurrency

Workers SHALL reserve outbox rows using `FOR UPDATE SKIP LOCKED` on Postgres and `BEGIN IMMEDIATE` row reservation on SQLite. Multiple workers MUST be safe to run concurrently against the same outbox.

#### Scenario: Two workers, no double dispatch

- **WHEN** two workers poll the outbox simultaneously and 10 messages are pending
- **THEN** each pending message is dispatched exactly once across the two workers

### Requirement: Workers run in-process by default

The library SHALL provide `postel.start({ concurrency })` to run workers in the host process. The same workers MUST be runnable in a separate process pointing at the same database without code changes.

#### Scenario: Same DB, separate worker process

- **WHEN** the host runs `postel.start()` in a dedicated process with no API server
- **THEN** outbox rows written by the API process are dispatched by the worker process

### Requirement: Adapter mode for external job queues

The library SHALL provide an adapter interface so a host can hand each delivery to BullMQ or pg-boss instead of running the built-in worker, while the library retains ownership of signing, retry policy, and dead-letter semantics.

#### Scenario: BullMQ adapter

- **WHEN** the host configures `postel` with the BullMQ adapter
- **THEN** outbox messages are pushed to BullMQ jobs that invoke the library's dispatch function
- **AND** retries / dead-letter still flow through library policy

### Requirement: Per-message TTL

Each message MAY carry a TTL. Messages older than the configured TTL SHALL be skipped on dispatch and marked `expired` in the attempts log.

#### Scenario: Expired message

- **WHEN** a message with a 1-hour TTL is picked up 2 hours later
- **THEN** no HTTP attempt is made
- **AND** the attempts log shows status `expired`

### Requirement: Per-endpoint and overall delivery deadlines

Each endpoint MUST be able to configure a per-request HTTP timeout and an overall deadline across all retries. Both deadlines MUST be enforced.

#### Scenario: Per-request timeout

- **WHEN** an endpoint has a 5-second request timeout and the receiver hangs
- **THEN** the request is aborted at 5 seconds and counted as a failed attempt

### Requirement: Per-endpoint custom HTTP headers

Endpoints SHALL accept constant or computed-per-message custom HTTP headers that are sent on every delivery attempt.

#### Scenario: Computed header per message

- **WHEN** an endpoint defines a header function `({ message }) => ({ 'x-trace': message.id })`
- **THEN** each attempt's request carries `x-trace: <message id>`

### Requirement: Per-endpoint payload transformation

Endpoints SHALL accept a pure transform function `(event) => bodyToSend`. Returning `null` or `undefined` SHALL skip delivery (no attempt, no retry).

#### Scenario: Transform skips delivery

- **WHEN** an endpoint's transform returns `null` for a given event
- **THEN** no HTTP request is made and the attempts log records `skipped`

### Requirement: Per-endpoint payload filter

Endpoints SHALL accept a pure predicate `(event) => boolean`. A `false` result SHALL skip delivery without retries.

#### Scenario: Filter rejects event

- **WHEN** an endpoint's filter returns `false` for a given event
- **THEN** no HTTP request is made and the attempts log records `filtered`

### Requirement: Graceful shutdown

Workers SHALL support a graceful shutdown that finishes in-flight HTTP attempts, persists their outcome, and exits cleanly. In-flight messages MUST NOT be lost.

#### Scenario: SIGTERM during dispatch

- **WHEN** a worker receives SIGTERM while an HTTP request is in flight
- **THEN** the worker waits for the request to complete, persists the attempt result, and exits

### Requirement: At-least-once delivery guarantee

The sender SHALL guarantee at-least-once delivery. The contract MUST be documented and verified by tests. Duplicate delivery is acceptable; lost delivery is not.

#### Scenario: Worker crash mid-attempt

- **WHEN** a worker reserves a message and crashes before recording the attempt outcome
- **THEN** the lease expires and another worker picks the message up
- **AND** the message is eventually delivered

### Requirement: Send latency budget

`send()` SHALL add ≤ 5 ms p99 to the host transaction. The single-insert design exists to meet this budget.

#### Scenario: Latency under load

- **WHEN** 10,000 concurrent `send()` calls are issued against a healthy Postgres
- **THEN** the p99 added latency is ≤ 5 ms

### Requirement: Worker throughput target

A 4-worker configuration on a single Postgres node SHALL sustain ≥ 10,000 deliveries/sec to a healthy receiver. This is a benchmarked target, published per release.

#### Scenario: Throughput benchmark

- **WHEN** the published benchmark suite is run against the reference setup
- **THEN** sustained throughput is ≥ 10,000 deliveries/sec for the duration of the benchmark

### Requirement: Outbox poll latency

Under normal load, the time from `send()` to first dispatch attempt SHALL be ≤ 100 ms p99. Postgres adapters MUST use `LISTEN`/`NOTIFY` to drive this; SQLite MAY poll.

#### Scenario: Postgres LISTEN/NOTIFY

- **WHEN** a message is inserted into the outbox on Postgres
- **THEN** an idle worker is woken via `NOTIFY` and starts dispatch within 100 ms p99

### Requirement: SSRF protection on outbound delivery

By default, outbound deliveries SHALL refuse to connect to private, loopback, or link-local IP ranges. An explicit allowlist MUST be available for testing.

#### Scenario: Refuse private IP

- **WHEN** an endpoint URL resolves to `10.0.0.5`
- **THEN** the dispatcher records a delivery error with reason `SSRF_BLOCKED`
- **AND** no HTTP request is sent

### Requirement: TLS verification by default

Outbound deliveries SHALL verify TLS certificates by default. Disabling TLS verification per endpoint MUST require an explicit opt-in flag and MUST emit a warning.

#### Scenario: Default TLS

- **WHEN** an endpoint has no TLS opt-out
- **THEN** the dispatcher uses standard TLS verification and rejects invalid certificates

### Requirement: DNS rebinding protection

For each delivery attempt, the dispatcher SHALL resolve the endpoint hostname once and pin the resolved IP for the duration of the connection. Re-resolution mid-connection MUST NOT change the target IP.

#### Scenario: Pinned IP

- **WHEN** a delivery resolves `hooks.example.com` to `203.0.113.10` and starts a connection
- **THEN** the connection uses `203.0.113.10` even if DNS subsequently changes

### Requirement: Outbox writes are part of the host transaction

The sender MUST NOT have a "send succeeded but the host transaction rolled back" failure mode. Outbox semantics require the insert to participate in the host's transaction.

#### Scenario: Host rollback eliminates the message

- **WHEN** the host opens a transaction, calls `send()`, then rolls back
- **THEN** no outbox row remains and no delivery occurs

