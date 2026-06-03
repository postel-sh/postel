# observability Specification

## Purpose

OpenTelemetry spans across send / dispatch / attempt / retry / replay operations, Prometheus metrics with `tenant_id` / `endpoint_id` / `event_type` labels, structured JSON logs correlated to active traces, a framework-agnostic admin HTTP handler builder, and a health-check endpoint suitable for load-balancer probes.
## Requirements
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

The library SHALL provide a framework-agnostic admin HTTP router builder, `adminRouter(postel, { authorize, resolveTenant? })`, returning a Web `(Request) => Promise<Response>`, plus mounts for Express, Hono, and Fastify (Hono mounts the Fetch handler natively; Express/Fastify via the `fetchToExpress` / `fetchToFastify` bridges). The route set covers the outbound control plane: list and create endpoints, get / update / delete an endpoint, disable (pause) an endpoint, rotate an endpoint secret, replay, reconcile, set a tenant rate limit, delete a tenant, and generate signing keys. Failures map to an HTTP status by `PostelError.code` (e.g. `ENDPOINT_NOT_FOUND` → 404, `ENDPOINT_VALIDATION` → 422, `ENDPOINT_DISABLED` → 409, `MIGRATION_REQUIRED` → 503), and the JSON error body carries the stable `code` as `errorCode`. Function-shaped endpoint options (`filter` / `transform` / callable `headers`) are code-only and SHALL NOT be configurable over HTTP.

Read/observability handlers — list events, list attempts (with pagination and filters), and view raw payload — are deferred until the outbound surface exposes a message/attempt query API; they are not part of this control-plane router.

**Conformance**: the route set, JSON request/response shapes, error→status mapping, and default-deny authorization posture are CONTRACT. The per-framework mount mechanism (a Web Fetch handler vs the Express/Fastify bridge) is PORT-SPECIFIC.

#### Scenario: Replay via admin handler

- **WHEN** an authorized admin POSTs `/admin/replay` with `{ messageId }`
- **THEN** the message is re-enqueued and the response confirms the action

#### Scenario: Endpoint CRUD via admin router

- **WHEN** an authorized admin POSTs `/admin/endpoints` with a valid create body
- **THEN** the endpoint is created (`201`) and a subsequent `GET /admin/endpoints/:id` returns it

#### Scenario: Unknown endpoint maps to 404

- **WHEN** an authorized admin GETs `/admin/endpoints/:id` for an id that does not exist
- **THEN** the response is `404` with `errorCode: "ENDPOINT_NOT_FOUND"`

#### Scenario: Default-deny without an authorize hook

- **WHEN** the admin router is mounted with no `authorize` hook configured
- **THEN** every request is rejected with `403` before any outbound call runs

### Requirement: Admin authorization predicate

Admin handlers SHALL only return data the caller is authorized to see. The host MUST pass an authorization predicate that the library applies to every read.

#### Scenario: Tenant-scoped admin

- **WHEN** an admin user authorized for tenant `t_42` lists attempts
- **THEN** only attempts whose `tenantId` is `t_42` are returned

### Requirement: Health check endpoint

The library SHALL provide `postel.health()` returning `{ ok, outbox_depth, oldest_pending_age, worker_count }`. The endpoint MUST complete in **≤ 10 ms p99 on the reference benchmark hardware, excluding network round-trip and load-balancer probe overhead**. It is safe to wire to load-balancer health probes at high frequency (e.g., every second).

#### Scenario: Healthy state

- **WHEN** the worker pool is healthy and outbox depth is 12
- **THEN** `health()` returns `{ ok: true, outbox_depth: 12, oldest_pending_age: <ms>, worker_count: 4 }`

#### Scenario: p99 latency under load

- **WHEN** `health()` is called 1,000 times per second concurrently
- **THEN** the p99 latency measured at the library boundary (excluding network) is ≤ 10 ms on the reference benchmark hardware

### Requirement: Configurable retention with automatic pruning

The library SHALL support configurable retention windows per row type (messages, attempts) with automatic background pruning. Pruning MUST NOT block dispatch.

#### Scenario: 30-day retention

- **WHEN** retention is set to 30 days for attempts and a row is older than 30 days
- **THEN** the pruning job removes the row asynchronously

