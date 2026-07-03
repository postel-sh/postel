# Tasks

## 1. Spec

- [x] 1.1 MODIFY `multi-tenancy` — ADD *Read a tenant by id*, *List tenants (paginated)*; MODIFY *Per-tenant rate limits* for the extensible, kind-tagged shape.
- [x] 1.2 MODIFY `api-surface-typescript` *Postel factory returns the library instance* — add `tenants.{get,list}` to the outbound surface.
- [x] 1.3 MODIFY `storage-layer` *BYO storage interface* — add `tenants.list` to the operation set; note the widened `tenants.get`.
- [x] 1.4 MODIFY `observability` *Admin HTTP handlers* — add the two tenant read routes.

## 2. Shared abstractions

- [x] 2.1 `pagination.ts`: `CursorOptions`, `Page<T>`.
- [x] 2.2 `strategies/rate-limit.ts`: `RateLimitStrategy`, `FixedRate`; export from `strategies/index.ts`.

## 3. Storage

- [x] 3.1 `storage/types.ts`: `TenantListFilter`; widen `tenants.get`; add `tenants.list`.
- [x] 3.2 `@postel/storage-helpers`: `decodeTenant`, `DEFAULT_TENANT_LIST_LIMIT`, `encodeTenantCursor` / `decodeTenantCursor`.
- [x] 3.3 Implement `tenants.list` + widen `tenants.get` in every adapter: memory, pg, sqlite, mysql, kysely, drizzle, prisma, typeorm, mikro-orm.
- [x] 3.4 Testkit battery: cover tenant reads naming the `storage-layer` requirement.

## 4. Core public API

- [x] 4.1 `outbound.ts`: `Tenant`, `TenantListOptions`, `TenantPage`; `OutboundApi.tenants.{get,list}`; wire in `buildOutboundRuntime`; `setRateLimit` persists via `FixedRate(...)`.
- [x] 4.2 Export the new public types from `@postel/core` root.

## 5. Admin HTTP

- [x] 5.1 `@postel/admin`: `GET /tenants`, `GET /tenants/:id` with authorize-derived tenant scoping and `TENANT_NOT_FOUND` → 404; malformed `?cursor=` → 400.

## 6. Tests + docs

- [x] 6.1 core `tenant-read-api.test.ts` (get existing/missing; rateLimit decode incl. legacy shape; list pagination across pages; limit validation; malformed-cursor throw).
- [x] 6.2 admin read-route tests (get one; 404 unknown; 404 cross-tenant; list paginated; bound-caller scoping; malformed cursor → 400).
- [x] 6.3 Docs: outbound tenants page + admin read routes; reference touch-ups.

## 7. Verify + archive

- [x] 7.1 `openspec validate add-tenant-read-api`; per-package `turbo run typecheck test lint`; `mise run docs:typecheck`.
- [x] 7.2 `openspec archive add-tenant-read-api -y`; `mise run check:all`.
- [x] 7.3 PR referencing #82 and the `multi-tenancy` capability.
