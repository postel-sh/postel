# endpoint-management Specification

## Purpose

CRUD and lifecycle primitives for delivery endpoints. Covers URL / HTTPS / SSRF validation at create time, the endpoint state machine with audit trail, per-endpoint signing configuration, per-endpoint custom headers and metadata, tenant scoping, and back-pressure caps (max in-flight retries).
## Requirements
### Requirement: Endpoint CRUD

The library SHALL expose `postel.endpoints.create`, `update`, `disable`, `delete`, `list`, `get`. Create accepts `{ url, types?, channels?, filter?, transform?, retryPolicy?, headers?, signing? }` and returns the created endpoint with a generated id. A read (`get`) or URL-affecting `update` targeting an id that does not exist SHALL throw the typed `EndpointNotFound` error (`code: ENDPOINT_NOT_FOUND`), never a plain `Error` discriminated by message string — so callers (including the admin HTTP router) can map it to `404` via class identity per the `api-surface-typescript` *No string matching on errors* requirement.

#### Scenario: Create and retrieve

- **WHEN** the host calls `endpoints.create({ url, types: ['order.*'] })`
- **THEN** the call returns an endpoint with a stable id
- **AND** `endpoints.get(id)` returns the same endpoint

#### Scenario: Get of an unknown id throws EndpointNotFound

- **WHEN** the host calls `endpoints.get(id)` with an id that does not exist
- **THEN** it throws `EndpointNotFound` whose `code` is `ENDPOINT_NOT_FOUND`
- **AND** the value is discriminable via `instanceof PostelError` without matching the message string

### Requirement: Endpoint state machine with audit trail

Endpoints SHALL transition between three states — `active`, `disabled`, and `circuit-open` — matching the canonical `endpoints.state` CHECK list in [`specs/db-schema/0001_init.sql`](../../../specs/db-schema/0001_init.sql). `re-enabled` is NOT a state; it is a transition *reason* recorded in `endpoint_state_transitions.reason` when a `disabled` endpoint moves back to `active`. Every state transition MUST be recorded in `endpoint_state_transitions` with the actor (`'system'` or a host-supplied user id), timestamp, the originating reason, and optional metadata.

#### Scenario: Auto-disable transition

- **WHEN** an endpoint hits the auto-disable threshold (see `retry-policy` for the canonical default)
- **THEN** its state transitions from `active` to `disabled`
- **AND** a row is appended to `endpoint_state_transitions` with `from_state: 'active'`, `to_state: 'disabled'`, `reason: 'auto-disable'`, `actor: 'system'`

#### Scenario: Circuit breaker opens

- **WHEN** an endpoint's circuit breaker (see `retry-policy`) trips
- **THEN** its state transitions from `active` to `circuit-open`
- **AND** the transition is recorded with `reason: 'circuit-open'`
- **AND** when the cooldown elapses and the breaker closes, a second transition records the `active` return with `reason: 'circuit-close'`

#### Scenario: Manual re-enable

- **WHEN** a disabled endpoint is manually re-enabled by an operator
- **THEN** its state transitions from `disabled` to `active`
- **AND** the transition is recorded with `reason: 're-enabled'` and the operator's actor id

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

Endpoint create SHALL validate the URL at the moment of creation:

- **HTTPS-only by default.** HTTP URLs are rejected unless the caller passes `allowHttp: true` as an explicit option to `endpoints.create`. The `allowHttp` flag MUST be discoverable in TypeScript types and is documented as intended for local development / testing only.
- **DNS resolution** MUST succeed. URLs whose hostnames don't resolve at create time are rejected.
- **SSRF check** MUST refuse private, loopback, or link-local IP ranges using the same policy enforced at dispatch (see `sender` `SSRF protection on outbound delivery`). The policy is defined once in this spec and referenced by `sender`.

#### Scenario: Reject http:// without override

- **WHEN** `endpoints.create({ url: 'http://example.com/hook' })` is called without `allowHttp`
- **THEN** the call fails with a structured `EndpointValidation` error naming the failing check (HTTPS-required)

#### Scenario: Accept http:// with override

- **WHEN** `endpoints.create({ url: 'http://localhost:3000/hook', allowHttp: true })` is called
- **THEN** the call succeeds (and the resulting endpoint carries the override; subsequent dispatch attempts also honor it)

#### Scenario: Reject SSRF-eligible IP

- **WHEN** an endpoint URL resolves to a private range (e.g., `10.0.0.5`) without an SSRF override
- **THEN** the call fails with a structured `EndpointValidation` error naming the failing check (SSRF-blocked)

### Requirement: Per-endpoint metadata field

Endpoints SHALL accept a host-defined JSON `metadata` field that is persisted alongside the endpoint and returned by `get`/`list`. The library MUST NOT interpret its contents.

#### Scenario: Round-trip metadata

- **WHEN** the host creates an endpoint with `metadata: { customerEmail: 'a@b' }`
- **THEN** `endpoints.get(id).metadata.customerEmail` equals `'a@b'`

### Requirement: Endpoint deletion semantics

When `endpoints.delete(endpointId)` is called, the library SHALL apply the following cascade behavior:

- **In-flight retries**: any in-flight `attempts` (rows whose latest `attempts.status` is `pending` and whose lease is still active) MUST complete or expire naturally; deletion MUST NOT abort an in-flight HTTP request mid-flight.
- **`endpoint_secrets`**: the DDL's `ON DELETE CASCADE` removes secret rows automatically; the caller is responsible for revoking those secrets at upstream KMS if applicable.
- **`attempts` history**: by default, historical attempt rows are PRESERVED for audit; the operator can opt into `endpoints.delete(id, { purgeAttempts: true })` to remove them.
- **`endpoint_state_transitions`**: preserved; the deletion itself is recorded as a final transition with `to_state: NULL` and `reason: 'deleted'`.
- **Dead-letter view**: rows from this endpoint remain visible in `dead_letter` after deletion unless `purgeAttempts: true` is used.

#### Scenario: Default deletion preserves audit trail

- **WHEN** `endpoints.delete('ep_42')` is called and `ep_42` has 1,000 historical attempts
- **THEN** the endpoint row is removed
- **AND** secrets cascade-delete via the DDL constraint
- **AND** all 1,000 attempts remain readable in `attempts` and `dead_letter`
- **AND** a final `endpoint_state_transitions` row is appended with `reason: 'deleted'`

#### Scenario: Purge variant removes history

- **WHEN** `endpoints.delete('ep_42', { purgeAttempts: true })` is called
- **THEN** the endpoint row, its secrets, and all its `attempts` rows are removed in a single transaction
- **AND** the `endpoint_state_transitions` history is also removed

#### Scenario: In-flight attempt isn't aborted

- **WHEN** an HTTP request to `ep_42` is in flight and `endpoints.delete('ep_42')` is called concurrently
- **THEN** the HTTP request completes (or times out) before the endpoint row is removed
- **AND** the resulting attempt row is recorded before deletion proceeds

