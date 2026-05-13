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

The library SHALL provide `postel.tenants.setRateLimit(tenantId, { perSecond })` to cap dispatch throughput per tenant.

#### Scenario: Tenant cap

- **WHEN** tenant `t_42` has `setRateLimit('t_42', { perSecond: 50 })` and 1000 messages are pending
- **THEN** dispatch to that tenant proceeds at no more than 50 attempts per second

### Requirement: Worker fairness across tenants

The worker scheduler SHALL round-robin across tenants by default so a burst from one tenant cannot starve others. Weighted-fair queueing MAY be configured per tenant.

#### Scenario: Burst does not starve

- **WHEN** tenant A has 10,000 pending messages and tenant B has 10
- **THEN** workers interleave dispatch across both tenants instead of finishing A entirely first

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

