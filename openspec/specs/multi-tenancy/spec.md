# multi-tenancy Specification

## Purpose

Tenant scoping across all persistent rows, per-tenant rate limits, worker fairness across tenants (round-robin or weighted-fair queueing), circuit-breaker isolation so one tenant's failures don't affect another's deliveries, and atomic tenant deletion with cascading semantics.
## Requirements
### Requirement: Tenant-scoped persistence

All persistent rows (endpoints, messages, attempts, secrets) SHALL carry a `tenantId` column. The column MAY be NULL for single-tenant deployments. Queries MUST filter by `tenantId` when one is provided.

#### Scenario: Single-tenant nullable

- **WHEN** the host configures the library without tenancy
- **THEN** rows are written with `tenantId = NULL` and queries omit the filter

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

### Requirement: Worker fairness across tenants

The library SHALL prevent tenant starvation: a burst of pending messages from one tenant MUST NOT block dispatch for messages belonging to other tenants for an unbounded period. The outcome — bounded latency across tenants under burst conditions — is part of the cross-port CONTRACT.

**Conformance**: the no-starvation outcome above is **CONTRACT**. The specific **scheduling algorithm** is **PORT-SPECIFIC**: the TypeScript reference implementation uses round-robin across tenants; ports MAY use weighted-fair queueing, asyncio's natural scheduling, deficit round-robin, or any equivalent scheme that satisfies the outcome. Optional weighted configuration (e.g., per-tenant priority) MAY be exposed per port.

#### Scenario: Burst does not starve

- **WHEN** tenant A has 10,000 pending messages and tenant B has 10
- **THEN** workers interleave dispatch across both tenants
- **AND** tenant B's 10 messages are dispatched within bounded time of tenant A's burst arriving (specific bound is per-port; for the TS reference impl: ≤ 10 dispatch cycles per tenant before yielding)

### Requirement: Per-tenant circuit breaker isolation

A failing endpoint in one tenant SHALL NOT affect dispatch to endpoints in any other tenant. Circuit breakers MUST be scoped per (tenant, endpoint).

#### Scenario: Tenant isolation

- **WHEN** every endpoint of tenant A is in `circuit-open`
- **THEN** dispatch to tenant B continues normally

### Requirement: Tenant deletion cascades

`postel.tenants.delete(tenantId)` SHALL cascade to delete all endpoints, messages, attempts, and secrets associated with the tenant. The deletion MUST be atomic.

#### Scenario: Cascade

- **WHEN** `tenants.delete('t_42')` is called and tenant `t_42` has 5 endpoints with 1000 messages and 5000 attempts
- **THEN** all 5 endpoints, 1000 messages, 5000 attempts, and any secrets are removed in a single transaction

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

