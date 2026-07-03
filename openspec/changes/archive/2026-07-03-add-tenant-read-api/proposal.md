## Why

`outbound.tenants` is write-only today (`setRateLimit` + `delete`) — there is no way to read a tenant back, even though storage already holds every tenant row. A dashboard can mutate tenant rate limits and delete tenants, but can't list or inspect them: the same dead end #80 fixed for messages via `message-introspection`. Issue #82 is a go-live blocker for 1.0.

## What Changes

- **New outbound read surface** on `postel.outbound.tenants`:
  - `tenants.get(id)` — the tenant (id, rate limit, metadata, createdAt) or `undefined` when absent.
  - `tenants.list(opts)` — tenants newest-first, keyset-paginated (`limit` + opaque `cursor`), with `nextCursor` null on the last page.
- **A reusable cursor-pagination shape** (`Page<T>` / `CursorOptions` in `@postel/core`), since this is the first paginated read in the library and future list reads (e.g. messages) can adopt the same shape instead of inventing their own.
- **An extensible `RateLimitStrategy`** (`FixedRate({ perSecond })` today), following the existing `RetryStrategy` / `KmsStrategy` / `WorkerStrategy` kind-discriminated-union convention, so `Tenant.rateLimit` isn't locked into a single hard-coded shape. `setRateLimit`'s existing call signature is unchanged; it now persists through `FixedRate(...)` internally, which additively tags the stored `metadata.rateLimit` with a `kind`. Reads decode both the new tagged shape and the pre-existing bare `{ perSecond }` shape.
- **Storage read operations**: add `tenants.list` to the `Storage` interface and widen `tenants.get` to accept the standard `HostTxOption`, implemented across every adapter, plus `decodeTenant` / cursor codec helpers in `@postel/storage-helpers`.
- **Admin HTTP read routes**: `GET /tenants` (paginated list) and `GET /tenants/:id` (`404 TENANT_NOT_FOUND` on absent or cross-tenant, no-leak — matching the message read-plane convention). The existing tenant write routes' `403` cross-tenant guard is untouched.

## Capabilities

### Modified Capabilities

- **`multi-tenancy`** — ADD *Read a tenant by id* and *List tenants (paginated)*. MODIFY *Per-tenant rate limits* to describe the extensible, kind-tagged `metadata.rateLimit` shape (additive; the existing `perSecond` scenario still holds).
- **`api-surface-typescript`** — MODIFY *Postel factory returns the library instance* to add `tenants.{get,list}` to the enumerated `postel.outbound` surface.
- **`storage-layer`** — MODIFY *BYO storage interface* to add `tenants.list` to the minimum operation set and note the widened `tenants.get` shape.
- **`observability`** — MODIFY *Admin HTTP handlers* to add the two tenant read routes.

## Wire-format / DB-schema impact

Wire-format: unchanged (reads only; `metadata.rateLimit` gains an additive `kind` key, no new columns). DB-schema: unchanged — reads existing `tenants` columns (`id`, `metadata`, `created_at`).

## Impact

- `@postel/core`: new public types `Tenant`, `TenantListOptions`, `TenantPage`; `OutboundApi.tenants.{get,list}`; new shared `Page<T>` / `CursorOptions` pagination types; new `RateLimitStrategy` / `FixedRate` strategy; new storage types `TenantListFilter`; widened `Storage.tenants.get`; new `Storage.tenants.list`. New exports from the package root.
- `@postel/storage-helpers`: `decodeTenant`, `DEFAULT_TENANT_LIST_LIMIT`, `encodeTenantCursor` / `decodeTenantCursor`.
- Storage adapters (`memory`, `pg`, `sqlite`, `mysql`, `kysely`, `drizzle`, `prisma`, `typeorm`, `mikro-orm`): implement `tenants.list`, widen `tenants.get`; shared testkit battery gains tenant-read coverage.
- `@postel/admin`: two `GET` read routes; no framework-adapter change (catch-all forwarding).
- Docs + tests updated accordingly.
