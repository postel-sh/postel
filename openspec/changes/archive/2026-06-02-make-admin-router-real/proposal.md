## Why

`@postel/admin` has been a scaffolded stub. The `observability` capability mandates a framework-agnostic admin HTTP handler builder (plus Express/Hono/Fastify adapters) and an authorization predicate, but no runtime existed — so operators have no way to drive the outbound control plane (endpoint CRUD, replay, key rotation) over HTTP. This change ships the real router.

## What Changes

- **`@postel/admin` becomes a real Fetch router**: `adminRouter(postel, { authorize, resolveTenant? }) => (req: Request) => Promise<Response>` mapping REST routes to `postel.outbound.*` — `GET/POST /endpoints`, `GET/PATCH/DELETE /endpoints/:id`, `POST /endpoints/:id/disable`, `POST /endpoints/:id/rotate-secret`, `POST /replay`, `POST /reconcile`, `POST /tenants/:id/rate-limit`, `DELETE /tenants/:id`, `POST /keys/{symmetric,asymmetric}`.
- **Default-deny authorization**: with no `authorize` hook every request is `403` (logged once). `authorize(req)` returns `boolean | { allow, status?, tenantId? }`. A returned `tenantId` scopes every route; by-id routes return `404` (not 403) for another tenant's resources so existence isn't leaked.
- **Error mapping** by `PostelError.code` (`ENDPOINT_NOT_FOUND`→404, `ENDPOINT_VALIDATION`→422, `ENDPOINT_DISABLED`/`IDEMPOTENCY_KEY_CONFLICT`→409, `MIGRATION_REQUIRED`→503; non-`PostelError`→500, `NOT_IMPLEMENTED`→501). Function-shaped endpoint options (`filter`/`transform`/callable `headers`) are not accepted over HTTP.
- **Framework mounts**: Hono mounts the Fetch router natively; `@postel/express` and `@postel/fastify` gain a generic `fetchToExpress` / `fetchToFastify` bridge.
- **Read/observability handlers** (list events, list attempts, view raw payload) are explicitly **deferred** until the outbound surface exposes a message/attempt query API — `OutboundApi` has no such read method today.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`observability`** — MODIFIED *Admin HTTP handlers*: describe the shipped control-plane route set, default-deny auth, error→status mapping, framework bridges, and the deferral of the query-dependent read handlers. (*Admin authorization predicate* is satisfied as-is; no delta.)

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: unchanged.

## Impact

- `typescript/packages/admin/` — real `adminRouter` (depends on `@postel/core`; uses `EndpointNotFound` for 404).
- `@postel/express` `fetchToExpress`, `@postel/fastify` `fetchToFastify`.
- `scripts/spec-drift-deferred.txt` — remove *Admin HTTP handlers* and *Admin authorization predicate* (now covered by tests).
- Docs: new `docs/content/docs/outbound/admin.mdx`; `reference/packages.mdx` (`@postel/admin` now real).
