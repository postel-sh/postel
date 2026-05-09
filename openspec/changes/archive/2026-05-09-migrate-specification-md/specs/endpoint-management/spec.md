# Endpoint management — delta spec

## ADDED Requirements

### Requirement: Endpoint CRUD

The library SHALL expose `postel.endpoints.create`, `update`, `disable`, `delete`, `list`, `get`. Create accepts `{ url, types?, channels?, filter?, transform?, retryPolicy?, headers?, signing? }` and returns the created endpoint with a generated id.

#### Scenario: Create and retrieve

- **WHEN** the host calls `endpoints.create({ url, types: ['order.*'] })`
- **THEN** the call returns an endpoint with a stable id
- **AND** `endpoints.get(id)` returns the same endpoint

### Requirement: Endpoint state machine with audit trail

Endpoints SHALL transition between `active`, `disabled`, and `re-enabled` states. Every transition MUST be recorded in an audit table with the actor, timestamp, and reason (manual or automatic).

#### Scenario: Auto-disable after failures

- **WHEN** an endpoint hits the auto-disable threshold (e.g., 100% failures over 24h)
- **THEN** its state moves to `disabled` and the transition is recorded with `actor: system` and `reason: auto-disable`

### Requirement: Per-endpoint signing config

Each endpoint SHALL choose a signing algorithm: `v1` (HMAC) or `v1a` (Ed25519). The algorithm MUST be rotatable to a different scheme without breaking deliveries currently in retry windows (the previous secret remains accepted by the receiver).

#### Scenario: Switch HMAC to Ed25519

- **WHEN** an endpoint with `v1` signing is rotated to `v1a`
- **THEN** new attempts use Ed25519 signatures
- **AND** the previous HMAC secret remains in the verification array until its retention window ends

### Requirement: Tenancy field

Every endpoint SHALL belong to a `tenantId` (opaque string from the host app). `tenantId` MAY be NULL in single-tenant deployments.

#### Scenario: Tenant-scoped list

- **WHEN** the host calls `endpoints.list({ tenantId: 't_42' })`
- **THEN** the result contains only endpoints whose `tenantId` is `t_42`

### Requirement: Per-endpoint queue depth cap

Endpoints MAY configure a maximum number of in-flight retries. Once exceeded, additional retries for that endpoint MUST queue or back-pressure rather than overwhelm the worker pool.

#### Scenario: Queue depth at cap

- **WHEN** an endpoint with cap=10 has 10 in-flight retries and an 11th attempt comes due
- **THEN** the 11th attempt is deferred until queue depth drops below 10

### Requirement: URL validation at create time

Endpoint create SHALL validate the URL: HTTPS required by default (overrideable), DNS resolution succeeds, SSRF check passes (no private/loopback/link-local IPs).

#### Scenario: Reject http:// without override

- **WHEN** `endpoints.create({ url: 'http://example.com/hook' })` is called without HTTPS override
- **THEN** the call fails with a structured validation error

### Requirement: Per-endpoint metadata field

Endpoints SHALL accept a host-defined JSON `metadata` field that is persisted alongside the endpoint and returned by `get`/`list`. The library MUST NOT interpret its contents.

#### Scenario: Round-trip metadata

- **WHEN** the host creates an endpoint with `metadata: { customerEmail: 'a@b' }`
- **THEN** `endpoints.get(id).metadata.customerEmail` equals `'a@b'`
