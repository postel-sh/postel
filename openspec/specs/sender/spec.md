# sender Specification

## Purpose

Outbound webhook delivery. Persists events to a transactional outbox (insert wrappable in the host's unit of work), reserves them for dispatch under row-level locks with crash-recoverable leases, retries with policy-driven backoff, fans out a single `send()` to all matching endpoints at dispatch time (late binding), and guarantees at-least-once delivery.
## Requirements
### Requirement: Send participates in the host transaction (outbox pattern)

The sender SHALL accept an optional database transaction handle (e.g., `db`) so the outbox insert can be wrapped in the host's business transaction. The library MUST NOT open a separate connection or fire-and-forget when a transaction is provided.

#### Scenario: Atomic with host write

- **WHEN** the host opens a transaction, performs business writes, calls `postel.send({...}, { db: tx })`, and rolls the transaction back
- **THEN** the outbox row is rolled back together with the host writes
- **AND** no delivery attempt occurs

### Requirement: Idempotent send by client-supplied key

When `idempotencyKey` is provided, a duplicate `send()` SHALL return the existing message's `id` with `reused: true`, without inserting a new row or scheduling a duplicate delivery. The first send with a given key reports `reused: false` — the flag is how a caller distinguishes "accepted" from "deduplicated".

#### Scenario: Repeat send with same key

- **WHEN** `postel.send({...}, { idempotencyKey: 'abc' })` is called twice with identical arguments
- **THEN** both calls return the same `id`
- **AND** the first call reports `reused: false` and the second reports `reused: true`
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

**Interim (TypeScript port):** `BullMQ(...)`, `PgBoss(...)`, and `External(...)` exist as typed `WorkerStrategy` factories, but no dispatch runtime has shipped for any of them. Configuring `outbound.workers` with anything other than `InProcess(...)` throws `NotImplementedError` at construction rather than silently running in-process or no-opping. See *Unimplemented config slots fail fast at construction* in `api-surface-typescript`. Their params stay `unknown` until a runtime lands — typing them is a breaking change to the factory signature, held out of the frozen typed surface for that reason.

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

### Requirement: Graceful shutdown

Workers SHALL support a graceful shutdown that finishes in-flight HTTP attempts, persists their outcome, and exits cleanly. In-flight messages MUST NOT be lost.

#### Scenario: SIGTERM during dispatch

- **WHEN** a worker receives SIGTERM while an HTTP request is in flight
- **THEN** the worker waits for the request to complete, persists the attempt result, and exits

### Requirement: At-least-once delivery guarantee

The sender SHALL guarantee at-least-once delivery. The contract MUST be documented and verified by tests. Duplicate delivery is acceptable; lost delivery is not. Crash recovery relies on the worker lease lifecycle owned by `storage-layer` (see `Worker lease lifecycle`): expired leases SHALL be reclaimable by another worker so a crashed worker never strands a message permanently.

#### Scenario: Worker crash mid-attempt

- **WHEN** a worker reserves a message and crashes before recording the attempt outcome
- **THEN** the lease (per `storage-layer` `Worker lease lifecycle`) expires and another worker reclaims the message via `expireStaleLeases`
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

**Interim (TypeScript port):** TLS-on is the runtime default (Node `fetch` verifies certificates), so the default behavior holds today. The per-endpoint opt-out path (`http.tls`, e.g. `{ verify: false }`) is not yet wired; configuring `http.tls` at the org level or as a per-endpoint override therefore throws `NotImplementedError` rather than silently leaving verification on. See *Unimplemented config slots fail fast at construction* in `api-surface-typescript`.

#### Scenario: Default TLS

- **WHEN** an endpoint has no TLS opt-out
- **THEN** the dispatcher uses standard TLS verification and rejects invalid certificates

### Requirement: DNS rebinding protection

For each delivery attempt, the dispatcher SHALL resolve the endpoint hostname once and pin the resolved IP for the duration of the connection. Re-resolution mid-connection MUST NOT change the target IP.

**Interim (TypeScript port):** the dispatcher validates every resolved address against the SSRF policy, but connection-time IP pinning has not shipped. The `http.dns` config slot (e.g. `{ pinResolution: true }`) is not yet wired; configuring it throws `NotImplementedError` rather than advertising a guarantee the runtime does not yet provide. See *Unimplemented config slots fail fast at construction* in `api-surface-typescript`.

#### Scenario: Pinned IP

- **WHEN** a delivery resolves `hooks.example.com` to `203.0.113.10` and starts a connection
- **THEN** the connection uses `203.0.113.10` even if DNS subsequently changes

### Requirement: Attempt status enum casing

The `attempts.status` column SHALL use **kebab-case** for all multi-word values to keep the enum visually uniform. The canonical set is: `pending`, `success`, `failed`, `failed-permanent`, `dead-letter`, `expired`, `filtered`, `skipped`, `ssrf-blocked`. The previously-used snake_case form (`ssrf_blocked`) is replaced by `ssrf-blocked` for casing consistency. When an outbound delivery is blocked by SSRF defense, the dispatcher MUST record the attempt with `status: 'ssrf-blocked'` AND a human-readable `error` field of `"SSRF_BLOCKED: <details>"` (the uppercase error code is separate from the column value, mirroring the receiver-side error-class convention).

#### Scenario: SSRF block records consistent casing

- **WHEN** an outbound delivery is blocked because the endpoint URL resolves to a disallowed IP range
- **THEN** the `attempts` row has `status = 'ssrf-blocked'` (kebab-case)
- **AND** the `error` field starts with `"SSRF_BLOCKED:"` (uppercase) and contains the resolved IP for debugging

#### Scenario: Other status values use kebab-case

- **WHEN** an attempt is recorded with a permanent failure (e.g., 4xx response other than 408/429)
- **THEN** the `attempts.status` value is `'failed-permanent'` (kebab-case), never `failed_permanent`

### Requirement: Concurrency model [PORT-SPECIFIC]

The library SHALL run worker dispatch concurrently to meet the throughput target. The choice of concurrency primitive (async/await with a worker pool, threads, goroutines, asyncio, an event loop, fiber-based scheduling, etc.) SHALL be port-specific. Ports MAY pick whatever primitive best fits their runtime.

**Conformance**: **PORT-SPECIFIC**. The outcomes that MUST hold across all ports — at-least-once delivery (see `At-least-once delivery guarantee`), worker reservation correctness under concurrency (see `Workers drain the outbox safely under concurrency`), graceful shutdown (see `Graceful shutdown`), and the published throughput target (see `Worker throughput target`) — remain CONTRACT regardless of the underlying concurrency mechanism.

#### Scenario: Different ports, different mechanisms, same guarantees

- **WHEN** the TS reference impl uses async/await + a worker pool and the Go port uses goroutines + channels
- **THEN** both ports pass the at-least-once, worker-reservation, graceful-shutdown, and throughput-target compliance tests
- **AND** the specific concurrency primitive is not part of the conformance contract

### Requirement: HTTP client implementation [PORT-SPECIFIC]

The library SHALL issue outbound HTTP requests when dispatching webhooks. The choice of HTTP client (`fetch`, `undici`, native `net/http`, `httpx`, `reqwest`, `OkHttp`, etc.) SHALL be port-specific. Ports MAY pick whatever HTTP client best fits their runtime.

**Conformance**: **PORT-SPECIFIC**. The wire-format requirements (`standard-webhooks-compliance`), per-endpoint and overall delivery deadlines (`Per-endpoint and overall delivery deadlines`), TLS verification (`TLS verification by default`), SSRF protection (`SSRF protection on outbound delivery`), and DNS rebinding protection (`DNS rebinding protection`) MUST be honored regardless of which HTTP client a port uses.

#### Scenario: Different ports, different HTTP clients, same wire output

- **WHEN** the TS reference impl uses `fetch` and the Go port uses `net/http`
- **THEN** both produce identical wire output for the same message + signing key (byte-identical headers, body, signature)
- **AND** both honor configured request and overall deadlines, TLS verification, SSRF blocks, and pinned DNS resolution
- **AND** the choice of HTTP client is not part of the conformance contract

### Requirement: Send is non-blocking and returns a SendResult

The library SHALL expose a public sender entry point of the form `postel.send({ type, data, channels?, idempotencyKey?, version? })` that synchronously persists the event into the outbox and returns a `SendResult` carrying the message identity: `id` (the `MessageId`) and `reused` (a boolean). `reused` SHALL be `true` only when a caller-supplied `idempotencyKey` matched an existing outbox row (see *Idempotent send by client-supplied key*); a send without an `idempotencyKey`, or one whose key matched no existing row, SHALL report `reused: false`. The call MUST NOT block on network I/O to the receiver.

#### Scenario: Successful enqueue

- **WHEN** the host calls `postel.send({ type: 'order.created', data: {...} })`
- **THEN** the library inserts the event into the outbox in a single SQL statement and returns a `SendResult` whose `id` is the new `MessageId` and whose `reused` is `false`
- **AND** no HTTP request to any receiver is made on this code path

### Requirement: Per-type event schema validation on send

The outbound side MAY declare an event registry — a map from event `type` string to a schema — that mirrors the receiver's per-source `schema`. When `send()` is called with a `type` present in the registry, the library SHALL validate `event.data` against the registered schema BEFORE the message is persisted to the outbox. On mismatch, `send()` SHALL throw `EventValidation` and MUST NOT write an outbox row for the rejected message. When `type` is absent from the registry, `send()` behaves exactly as it does today: no validation is attempted and the message is persisted unchanged.

**Conformance**: the validation OUTCOME (validate before persisting; throw on mismatch; no partial/rejected outbox row) is CONTRACT. The registry's schema mechanism is a TypeScript-port detail — see `api-surface-typescript`.

#### Scenario: Registered type with valid data persists normally

- **WHEN** `send({ type: "user.created", data })` is called and `"user.created"` is registered with a schema that `data` satisfies
- **THEN** the outbox row is written exactly as it would be with no registry configured

#### Scenario: Registered type with invalid data is rejected before persistence

- **WHEN** `send({ type: "user.created", data })` is called and `data` does not satisfy the registered schema for `"user.created"`
- **THEN** `send()` throws `EventValidation` and does not persist an outbox row for that message

#### Scenario: Unregistered type is fully permissive

- **WHEN** `send({ type: "some.unregistered.type", data })` is called and no schema is registered for that `type`
- **THEN** no validation is attempted and the message is persisted unchanged, identical to today's behavior

