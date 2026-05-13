# multi-tenancy — delta spec

## MODIFIED Requirements

### Requirement: Per-tenant rate limits

The library SHALL provide `postel.tenants.setRateLimit(tenantId, { perSecond })` to cap dispatch throughput per tenant. Rate-limit configuration MUST be persisted in the `tenants.metadata` JSONB column under a reserved `rateLimit` key (e.g., `metadata.rateLimit = { perSecond: 50 }`). When the rate is exceeded, additional dispatch attempts SHALL queue rather than drop; back-pressure propagates to the worker scheduler.

#### Scenario: Tenant cap with queue back-pressure

- **WHEN** tenant `t_42` has `setRateLimit('t_42', { perSecond: 50 })` and 1000 messages are pending
- **THEN** dispatch to that tenant proceeds at no more than 50 attempts per second
- **AND** excess attempts queue inside the worker scheduler (none are dropped)

#### Scenario: Rate limit persisted

- **WHEN** `setRateLimit('t_42', { perSecond: 50 })` is called
- **THEN** the `tenants` row for `t_42` has `metadata.rateLimit.perSecond = 50`
- **AND** a subsequent library boot reads the same value back without re-configuration

## ADDED Requirements

### Requirement: Naming convention for tenant scoping

Naming for tenant-scoped identifiers SHALL follow a single canonical convention across all artifacts:

- **Database columns**: `tenant_id` (snake_case) — matches the DDL.
- **Prometheus / OTel labels**: `tenant_id` (snake_case) — matches the DDL for grep-ability.
- **TypeScript public API** (function arguments, return values, object fields): `tenantId` (camelCase).
- **JSON over the wire** (admin handler responses, etc.): `tenantId` (camelCase) to match TypeScript convention.

Every capability spec, ADR, AsyncAPI document, and DDL file MUST follow this mapping. Other language ports honor the equivalent idiomatic conventions (e.g., `tenant_id` for Python, `TenantID` for Go).

#### Scenario: Drift caught in code review

- **WHEN** a capability spec references a tenant identifier
- **THEN** the spec uses `tenant_id` if discussing DB columns or metric labels, and `tenantId` if discussing the public TypeScript API
- **AND** a reviewer rejects mixed usage in the same context
