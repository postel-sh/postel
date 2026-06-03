## MODIFIED Requirements

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
