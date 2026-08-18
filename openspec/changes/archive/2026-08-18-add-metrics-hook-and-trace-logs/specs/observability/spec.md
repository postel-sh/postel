## MODIFIED Requirements

### Requirement: Prometheus metrics

The library SHALL expose Prometheus metrics: `webhook_send_total`, `webhook_attempt_duration_seconds`, `webhook_attempt_success_ratio`, `webhook_dead_letter_total`, `webhook_outbox_depth`, `webhook_endpoint_circuit_state`. Each metric MUST carry `tenant_id`, `endpoint_id`, `event_type` labels where applicable.

**Conformance**: the metric names, the label keys each metric carries, and what each metric SHALL reflect (a monotonic total, a latency observation, a point-in-time ratio or gauge) are CONTRACT. The exposition mechanism is PORT-SPECIFIC: this port exposes a pull-based `postel.metrics()` snapshot (a plain in-memory registry, no `prom-client` dependency) rather than a push callback or a bundled Prometheus client; other ports MAY expose the same metrics through their own idiomatic registry or client binding.

#### Scenario: Outbox depth metric

- **WHEN** there are 42 unprocessed messages in the outbox for tenant `t_42`
- **THEN** `webhook_outbox_depth{tenant_id="t_42"}` reads 42

#### Scenario: Send counter increments per event type

- **WHEN** a host sends two messages of event type `order.created` for tenant `t_1`
- **THEN** `postel.metrics()` reports `webhook_send_total` as 2 for `{tenant_id: "t_1", event_type: "order.created"}`

#### Scenario: Attempt duration histogram observes dispatch latency

- **WHEN** a dispatch attempt to endpoint `ep_1` completes
- **THEN** `postel.metrics()` reports a `webhook_attempt_duration_seconds` sample for `{endpoint_id: "ep_1"}` whose count is at least 1 and whose sum reflects the attempt's latency in seconds

#### Scenario: Success ratio reflects attempt outcomes

- **WHEN** an endpoint has 3 successful attempts and 1 failed attempt
- **THEN** `postel.metrics()` reports `webhook_attempt_success_ratio` as 0.75 for that endpoint

#### Scenario: Dead-letter counter increments on exhaustion

- **WHEN** a message's retries are exhausted and it is dead-lettered
- **THEN** `postel.metrics()` reports `webhook_dead_letter_total` incremented by 1 for that endpoint

#### Scenario: Circuit state gauge reflects open/close transitions

- **WHEN** an endpoint's circuit breaker opens and later closes
- **THEN** `postel.metrics()` reports `webhook_endpoint_circuit_state` as 1 while open and 0 once closed

#### Scenario: No outbound configured reports empty metrics

- **WHEN** a Postel instance has no `outbound` slot configured
- **THEN** `postel.metrics()` resolves with every metric array empty rather than rejecting

### Requirement: Structured JSON logs with trace correlation

The library SHALL emit structured JSON logs. Each log line MUST include the active trace id when one is present, so logs and traces can be correlated.

**Conformance**: that a `trace_id` field is present whenever a log-worthy runtime event occurs inside an active OpenTelemetry trace, and absent otherwise, is CONTRACT. The delivery mechanism is PORT-SPECIFIC: this port carries `trace_id` on the same `LogEvent` entries forwarded through the `observability.logger` pass-through (see *Logger pass-through for runtime events*) rather than owning a JSON log writer itself; the host's own logger remains responsible for serializing the entry as JSON.

#### Scenario: Trace id in log line

- **WHEN** a dispatch attempt completes inside a traced context
- **THEN** the resulting log line contains a `trace_id` field matching the OTel span

#### Scenario: No active trace omits the field

- **WHEN** a dispatch attempt completes with no active OpenTelemetry span (no provider registered, or `@opentelemetry/api` is not installed)
- **THEN** the forwarded log entry carries no `trace_id` field

### Requirement: Admin HTTP handlers

The library SHALL provide a framework-agnostic admin HTTP router builder, `adminRouter(postel, { authorize, resolveTenant? })`, returning a Web `(Request) => Promise<Response>`, plus mounts for Express, Hono, and Fastify (Hono mounts the Fetch handler natively; Express/Fastify via the `fetchToExpress` / `fetchToFastify` bridges). The route set covers the outbound control plane: list and create endpoints, get / update / delete an endpoint, disable (pause) an endpoint, rotate an endpoint secret, replay, reconcile, set a tenant rate limit, delete a tenant, and generate signing keys. It also covers the outbound read plane: `GET /messages` (list with tenant / type / status / time-window filters), `GET /messages/:id` (fetch one message including its raw payload), `GET /messages/:id/attempts` (the message's delivery-attempt history, filterable by attempt delivery `?status=` — repeatable and/or comma-separated; when present, only attempts whose `status` matches are returned, still ordered by `attemptNumber`; unknown values match nothing, as on `GET /messages`) — backed by the `message-introspection` capability — and `GET /tenants`, `GET /tenants/:id` (fetch one tenant) — backed by the `multi-tenancy` capability's tenant-read requirements. It also covers `GET /health`, wrapping `postel.health()` so ops tooling gets the queue-depth / oldest-pending gauges over HTTP through the same authorized router.

Every list-returning route is paginated with one convention: `GET /endpoints`, `GET /messages`, and `GET /tenants` accept `?limit=` / `?cursor=`, and `POST /reconcile` accepts `limit` / `cursor` in its JSON body. Each responds with the matching plural key plus a `nextCursor` — `{ endpoints, nextCursor }`, `{ messages, nextCursor }`, `{ tenants, nextCursor }`, `{ messageIds, nextCursor }` — where `nextCursor` is `null` on the last page and otherwise the opaque token the caller passes back to fetch the next page. No list route returns an unbounded array: a conservative default limit applies when the caller gives none.

Failures map to an HTTP status by `PostelError.code` (e.g. `ENDPOINT_NOT_FOUND` → 404, `ENDPOINT_VALIDATION` → 422, `ENDPOINT_DISABLED` → 409, `MIGRATION_REQUIRED` → 503), and the JSON error body carries the stable `code` as `errorCode`. A read for a message id that does not exist (or is outside the caller's tenant) responds `404` with `errorCode: "MESSAGE_NOT_FOUND"`; a read for a tenant id that does not exist (or is outside the caller's tenant) responds `404` with `errorCode: "TENANT_NOT_FOUND"`; a malformed `cursor` or non-positive / non-integer `limit` on any cursor-accepting route (`GET /endpoints`, `GET /messages`, `GET /tenants`, `POST /reconcile`) responds `400` with `errorCode: "INVALID_QUERY"`. A `since` / `until` value that does not parse to a valid date — on `GET /messages`, `POST /replay`, or `POST /reconcile` — likewise responds `400` with `errorCode: "INVALID_QUERY"`. Function-shaped endpoint options (`filter` / `transform` / callable `headers`) are code-only and SHALL NOT be configurable over HTTP.

The read routes are tenant-scoped exactly like the control-plane routes: a tenant-bound caller sees only its own tenant's messages, attempts, and tenant record, and a cross-tenant read resolves as not-found rather than leaking existence. This is intentionally asymmetric with the existing tenant *write* routes (`POST /tenants/:id/rate-limit`, `DELETE /tenants/:id`), which respond `403` on cross-tenant access — the read-plane's no-leak `404` convention is scoped to reads. `GET /health` reflects the whole instance, not a tenant — it carries no tenant scoping.

**Conformance**: the route set, JSON request/response shapes, error→status mapping, and default-deny authorization posture are CONTRACT. The per-framework mount mechanism (a Web Fetch handler vs. the Express/Fastify bridge) is PORT-SPECIFIC.

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

#### Scenario: Read a message and its attempts via admin router

- **WHEN** an authorized admin GETs `/admin/messages/:id` for a message that was sent and attempted
- **THEN** the response is `200` carrying the message (including its payload)
- **AND** a subsequent `GET /admin/messages/:id/attempts` returns that message's attempt history with status, response code, and latency

#### Scenario: Filter attempts by status via admin router

- **WHEN** an authorized admin GETs `/admin/messages/:id/attempts?status=failed` for a message with both failed and successful attempts
- **THEN** the response is `200` with an `attempts` array containing only the `failed` attempts, ordered by `attemptNumber`

#### Scenario: Read of an unknown message maps to 404

- **WHEN** an authorized admin GETs `/admin/messages/:id` for an id that does not exist
- **THEN** the response is `404` with `errorCode: "MESSAGE_NOT_FOUND"`

#### Scenario: List messages via admin router

- **WHEN** an authorized admin GETs `/admin/messages?type=order.created&limit=50`
- **THEN** the response is `200` with a `messages` array containing only `order.created` messages, newest-first, capped at the limit
- **AND** the body carries a `nextCursor` that is non-null when more matching messages remain and feeds a subsequent `?cursor=` request for the next page

#### Scenario: List endpoints via admin router (paginated)

- **WHEN** an authorized admin GETs `/admin/endpoints?limit=2` over a store holding more than two endpoints
- **THEN** the response is `200` with an `endpoints` array of at most two endpoints, newest-first, and a non-null `nextCursor`
- **AND** feeding that `nextCursor` back as `?cursor=` returns the next page, with `nextCursor` `null` once the set is exhausted

#### Scenario: Reconcile via admin handler returns a bounded page

- **WHEN** an authorized admin POSTs `/admin/reconcile` with `{ endpointId, since, limit }` over a backlog larger than `limit`
- **THEN** the response is `200` with a `messageIds` array of at most `limit` ids and a non-null `nextCursor`
- **AND** POSTing again with that `nextCursor` as `cursor` resumes the backlog where the previous page ended

#### Scenario: Read a tenant via admin router

- **WHEN** an authorized admin GETs `/admin/tenants/:id` for a tenant that exists
- **THEN** the response is `200` carrying the tenant, including its decoded `rateLimit`

#### Scenario: Read of an unknown or cross-tenant tenant maps to 404

- **WHEN** an authorized admin bound to tenant `t_1` GETs `/admin/tenants/:id` for an id that does not exist, or for tenant `t_2`
- **THEN** the response is `404` with `errorCode: "TENANT_NOT_FOUND"` in both cases

#### Scenario: List tenants via admin router

- **WHEN** an unbound authorized admin GETs `/admin/tenants?limit=2`
- **THEN** the response is `200` with a `tenants` array of at most two tenants, newest-first, and a `nextCursor` for the next page when more tenants remain

#### Scenario: A tenant-bound caller listing tenants sees only its own tenant

- **WHEN** an authorized admin bound to tenant `t_1` GETs `/admin/tenants`
- **THEN** the response's `tenants` array contains only `t_1`'s own tenant record (or is empty if `t_1` has no tenant row), and `nextCursor` is `null`

#### Scenario: A malformed date maps to 400 on the replay and reconcile routes

- **WHEN** an authorized admin POSTs `/admin/reconcile` with `{ endpointId, since: "not-a-date" }`, or `/admin/replay` with `{ endpointId, since: "not-a-date", freshWebhookId: false }`
- **THEN** each response is `400` with `errorCode: "INVALID_QUERY"`

#### Scenario: A malformed list cursor maps to 400 on every cursor-accepting route

- **WHEN** an authorized admin GETs `/admin/tenants?cursor=not-a-valid-cursor`, `/admin/endpoints?cursor=not-a-valid-cursor`, or `/admin/messages?cursor=not-a-valid-cursor`, or POSTs `/admin/reconcile` with `{ endpointId, since, cursor: "not-a-valid-cursor" }`
- **THEN** each response is `400` with `errorCode: "INVALID_QUERY"`

#### Scenario: Health via admin router

- **WHEN** an authorized admin GETs `/admin/health`
- **THEN** the response carries the same `{ ok, outboxDepth, oldestPendingAge, workerCount }` shape as `postel.health()`, with HTTP status `200` when `ok` is `true` and `503` when `ok` is `false`
