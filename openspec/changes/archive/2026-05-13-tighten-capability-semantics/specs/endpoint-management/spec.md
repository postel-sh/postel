# endpoint-management — delta spec

## MODIFIED Requirements

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

## ADDED Requirements

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
