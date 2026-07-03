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

The library SHALL provide `postel.tenants.setRateLimit(tenantId, { perSecond })` to cap dispatch throughput per tenant. Rate-limit configuration MUST be persisted in the `tenants.metadata` JSONB column under a reserved `rateLimit` key as an extensible, kind-discriminated `RateLimitStrategy` (e.g. `metadata.rateLimit = { kind: 'fixed', perSecond: 50 }`), following the same strategy convention as `RetryStrategy` / `KmsStrategy` / `WorkerStrategy` — so a future variant (e.g. a token-bucket strategy) can be added without a breaking change to the read surface. `setRateLimit`'s call signature accepts `{ perSecond }` today and constructs the `fixed` strategy internally. When the rate is exceeded, additional dispatch attempts SHALL queue rather than drop; back-pressure propagates to the worker scheduler.

Reads of a tenant's `rateLimit` (see *Read a tenant by id*) MUST decode both the current kind-tagged shape and a pre-existing bare `{ perSecond }` row written before the `kind` tag existed, treating the latter as the `fixed` strategy — this is a backward-compatible read, not a data migration.

**Conformance**: the OUTCOME — per-tenant dispatch throttling is configurable and persisted, and is readable back in a strategy-shaped form — is CONTRACT. The specific `RateLimitStrategy` variant set (today: `fixed` only) and its `kind` discriminator are TypeScript-port mechanisms; other ports MAY expose additional strategies or none.

#### Scenario: Tenant cap with queue back-pressure

- **WHEN** tenant `t_42` has `setRateLimit('t_42', { perSecond: 50 })` and 1000 messages are pending
- **THEN** dispatch to that tenant proceeds at no more than 50 attempts per second
- **AND** excess attempts queue inside the worker scheduler (none are dropped)

#### Scenario: Rate limit persisted

- **WHEN** `setRateLimit('t_42', { perSecond: 50 })` is called
- **THEN** the `tenants` row for `t_42` has `metadata.rateLimit.perSecond = 50`
- **AND** a subsequent library boot reads the same value back without re-configuration

#### Scenario: Legacy bare rate-limit shape still decodes

- **WHEN** a tenant's `metadata.rateLimit` is the pre-existing bare shape `{ perSecond: 50 }` (no `kind` tag)
- **THEN** `outbound.tenants.get(id)` decodes it as the `fixed` `RateLimitStrategy` with `perSecond: 50`

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

### Requirement: Read a tenant by id

The library SHALL provide a read that returns a single tenant by its `TenantId`. The returned tenant MUST carry the tenant `id`, its decoded `rateLimit` (a `RateLimitStrategy`, or `null` when no rate limit has been configured), its raw `metadata`, and `createdAt`. When no tenant matches the id, the read SHALL resolve to an absent result rather than throwing.

#### Scenario: Get an existing tenant returns its rate limit and metadata

- **WHEN** the host calls `outbound.tenants.get(id)` for a tenant that previously had `setRateLimit(id, { perSecond: 50 })` called on it
- **THEN** the result's `id` matches the requested id
- **AND** the result's `rateLimit` is the fixed-rate strategy carrying `perSecond: 50`

#### Scenario: Get a missing tenant resolves absent

- **WHEN** the host calls `outbound.tenants.get(id)` for an id that was never created
- **THEN** the read resolves to an absent result (no tenant)
- **AND** it does not throw

### Requirement: List tenants (paginated)

The library SHALL provide a read that lists tenants newest-first (by creation time), bounded by a caller-supplied `limit` with a conservative default applied when none is given, using opaque keyset cursor pagination rather than offset pagination — the `tenants` table SHALL NOT be assumed to be low-cardinality. The read returns a page carrying the tenants and a `nextCursor`, which is `null` on the last page and otherwise an opaque token the caller passes back as `cursor` to fetch the next page.

#### Scenario: List returns tenants newest-first

- **WHEN** the host calls `outbound.tenants.list()` over a store holding multiple tenants created at different times
- **THEN** the result's tenants are ordered newest-first by creation time

#### Scenario: Limit bounds the page size

- **WHEN** the host calls `outbound.tenants.list({ limit: 2 })` over a store holding more than two tenants
- **THEN** at most two tenants are returned in the page

#### Scenario: Cursor pagination walks the full set without gaps or duplicates

- **WHEN** the host repeatedly calls `outbound.tenants.list({ limit, cursor })`, starting with no cursor and feeding each page's `nextCursor` into the next call, over a store holding more tenants than fit in one page
- **THEN** every tenant is returned exactly once across the pages, in newest-first order
- **AND** the final page's `nextCursor` is `null`

#### Scenario: Empty store returns an empty page

- **WHEN** the host calls `outbound.tenants.list()` over a store holding no tenants
- **THEN** the result's tenants list is empty and `nextCursor` is `null`

