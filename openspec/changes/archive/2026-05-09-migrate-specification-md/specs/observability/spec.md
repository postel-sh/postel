# Observability — delta spec

## ADDED Requirements

### Requirement: OpenTelemetry spans on every operation

The library SHALL emit OpenTelemetry spans for `send`, `dispatch`, `attempt`, `retry`, and `replay` operations. Span attributes MUST follow the OTel semantic conventions for HTTP where applicable.

#### Scenario: Trace propagation

- **WHEN** the host runs in a traced HTTP handler that calls `send()`
- **THEN** the resulting `send` span is a child of the host's HTTP span and carries the same trace id

### Requirement: Prometheus metrics

The library SHALL expose Prometheus metrics: `webhook_send_total`, `webhook_attempt_duration_seconds`, `webhook_attempt_success_ratio`, `webhook_dead_letter_total`, `webhook_outbox_depth`, `webhook_endpoint_circuit_state`. Each metric MUST carry `tenant_id`, `endpoint_id`, `event_type` labels where applicable.

#### Scenario: Outbox depth metric

- **WHEN** there are 42 unprocessed messages in the outbox for tenant `t_42`
- **THEN** `webhook_outbox_depth{tenant_id="t_42"}` reads 42

### Requirement: Structured JSON logs with trace correlation

The library SHALL emit structured JSON logs. Each log line MUST include the active trace id when one is present, so logs and traces can be correlated.

#### Scenario: Trace id in log line

- **WHEN** a dispatch attempt completes inside a traced context
- **THEN** the resulting log line contains a `trace_id` field matching the OTel span

### Requirement: Admin HTTP handlers

The library SHALL provide a framework-agnostic admin handler builder plus adapters for Express, Hono, and Fastify. The handler set MUST cover: list events, list endpoints, list attempts (with pagination and filters), view raw payload, replay, pause endpoint, resume endpoint, rotate secret.

#### Scenario: Replay via admin handler

- **WHEN** an authorized admin POSTs `/admin/replay` with `{ messageId }`
- **THEN** the message is re-enqueued and the response confirms the action

### Requirement: Admin authorization predicate

Admin handlers SHALL only return data the caller is authorized to see. The host MUST pass an authorization predicate that the library applies to every read.

#### Scenario: Tenant-scoped admin

- **WHEN** an admin user authorized for tenant `t_42` lists attempts
- **THEN** only attempts whose `tenantId` is `t_42` are returned

### Requirement: Health check endpoint

The library SHALL provide `postel.health()` returning `{ ok, outbox_depth, oldest_pending_age, worker_count }`. The endpoint MUST be cheap (≤ 10ms) so it is safe to wire to load-balancer probes.

#### Scenario: Healthy state

- **WHEN** the worker pool is healthy and outbox depth is 12
- **THEN** `health()` returns `{ ok: true, outbox_depth: 12, oldest_pending_age: <ms>, worker_count: 4 }`

### Requirement: Configurable retention with automatic pruning

The library SHALL support configurable retention windows per row type (messages, attempts) with automatic background pruning. Pruning MUST NOT block dispatch.

#### Scenario: 30-day retention

- **WHEN** retention is set to 30 days for attempts and a row is older than 30 days
- **THEN** the pruning job removes the row asynchronously
