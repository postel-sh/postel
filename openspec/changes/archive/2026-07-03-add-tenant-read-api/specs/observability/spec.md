## MODIFIED Requirements

### Requirement: Admin HTTP handlers

The library SHALL provide a framework-agnostic admin HTTP router builder, `adminRouter(postel, { authorize, resolveTenant? })`, returning a Web `(Request) => Promise<Response>`, plus mounts for Express, Hono, and Fastify (Hono mounts the Fetch handler natively; Express/Fastify via the `fetchToExpress` / `fetchToFastify` bridges). The route set covers the outbound control plane: list and create endpoints, get / update / delete an endpoint, disable (pause) an endpoint, rotate an endpoint secret, replay, reconcile, set a tenant rate limit, delete a tenant, and generate signing keys. It also covers the outbound read plane: `GET /messages` (list with tenant / type / status / time-window filters and a bounded `limit`), `GET /messages/:id` (fetch one message including its raw payload), `GET /messages/:id/attempts` (the message's delivery-attempt history) — backed by the `message-introspection` capability — and `GET /tenants` (paginated list, `?limit=` / `?cursor=`), `GET /tenants/:id` (fetch one tenant) — backed by the `multi-tenancy` capability's tenant-read requirements. Failures map to an HTTP status by `PostelError.code` (e.g. `ENDPOINT_NOT_FOUND` → 404, `ENDPOINT_VALIDATION` → 422, `ENDPOINT_DISABLED` → 409, `MIGRATION_REQUIRED` → 503), and the JSON error body carries the stable `code` as `errorCode`. A read for a message id that does not exist (or is outside the caller's tenant) responds `404` with `errorCode: "MESSAGE_NOT_FOUND"`; a read for a tenant id that does not exist (or is outside the caller's tenant) responds `404` with `errorCode: "TENANT_NOT_FOUND"`; a malformed `?cursor=` on `GET /tenants` responds `400` with `errorCode: "INVALID_QUERY"`. Function-shaped endpoint options (`filter` / `transform` / callable `headers`) are code-only and SHALL NOT be configurable over HTTP.

The read routes are tenant-scoped exactly like the control-plane routes: a tenant-bound caller sees only its own tenant's messages, attempts, and tenant record, and a cross-tenant read resolves as not-found rather than leaking existence. This is intentionally asymmetric with the existing tenant *write* routes (`POST /tenants/:id/rate-limit`, `DELETE /tenants/:id`), which respond `403` on cross-tenant access — the read-plane's no-leak `404` convention is scoped to reads.

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

#### Scenario: Read a message and its attempts via admin router

- **WHEN** an authorized admin GETs `/admin/messages/:id` for a message that was sent and attempted
- **THEN** the response is `200` carrying the message (including its payload)
- **AND** a subsequent `GET /admin/messages/:id/attempts` returns that message's attempt history with status, response code, and latency

#### Scenario: Read of an unknown message maps to 404

- **WHEN** an authorized admin GETs `/admin/messages/:id` for an id that does not exist
- **THEN** the response is `404` with `errorCode: "MESSAGE_NOT_FOUND"`

#### Scenario: List messages via admin router

- **WHEN** an authorized admin GETs `/admin/messages?type=order.created&limit=50`
- **THEN** the response is `200` with a `messages` array containing only `order.created` messages, newest-first, capped at the limit

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

#### Scenario: A malformed tenant list cursor maps to 400

- **WHEN** an authorized admin GETs `/admin/tenants?cursor=not-a-valid-cursor`
- **THEN** the response is `400` with `errorCode: "INVALID_QUERY"`
