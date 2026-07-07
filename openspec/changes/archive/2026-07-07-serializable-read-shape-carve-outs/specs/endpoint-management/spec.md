## MODIFIED Requirements

### Requirement: Endpoint CRUD

The library SHALL expose `postel.endpoints.create`, `update`, `disable`, `delete`, `list`, `get`. Create accepts `{ url, types?, channels?, filter?, transform?, retryPolicy?, headers?, signing? }` and returns the created endpoint with a generated id.

The endpoint returned by `create`, `get`, `list`, and `update` SHALL round-trip every accepted serializable field: `url`, `state`, `types`, `channels`, `retryPolicy`, `allowHttp`, `maxInflight`, `http`, `circuitBreaker`, `autoDisable`, `metadata`, `tenantId`, plus the record timestamps `createdAt` and `updatedAt`. `headers` SHALL be returned when (and only when) it was configured as a plain key/value record.

Function-shaped options are code-side JS values, not serializable data, and SHALL NOT appear on the public read shape — with identical results across storage adapters:

- `filter` and `transform` are absent keys on the returned endpoint.
- Callable `headers` read back as `null` (the key is present; only plain-record headers round-trip).
- A `custom` retryPolicy carries a `compute` function and reads back as `null`; data-only strategies (`exponential`, `linear`) round-trip unchanged.
- The returned `http` is the stored HTTP overrides minus the function-typed `fetch` key.
- `signing` SHALL NOT appear on the read shape either: a signing strategy can carry key material and is never echoed back.

A read (`get`) or URL-affecting `update` targeting an id that does not exist SHALL throw the typed `EndpointNotFound` error (`code: ENDPOINT_NOT_FOUND`), never a plain `Error` discriminated by message string — so callers (including the admin HTTP router) can map it to `404` via class identity per the `api-surface-typescript` *No string matching on errors* requirement.

#### Scenario: Create and retrieve

- **WHEN** the host calls `endpoints.create({ url, types: ['order.*'] })`
- **THEN** the call returns an endpoint with a stable id
- **AND** `endpoints.get(id)` returns the same endpoint

#### Scenario: Create round-trips every accepted serializable field

- **WHEN** the host creates an endpoint with `types`, `channels`, a `retryPolicy`, plain-record `headers`, `metadata`, `allowHttp`, `maxInflight`, `http`, `circuitBreaker`, and `autoDisable`
- **THEN** the returned endpoint carries each of those fields with the accepted values, together with `id`, `url`, `state`, `createdAt`, and `updatedAt`
- **AND** `endpoints.get(id)` and `endpoints.list()` return the same field values

#### Scenario: Update returns the effective endpoint

- **WHEN** the host calls `endpoints.update(id, { channels: ['eu'] })` on an endpoint created with `types` and a `retryPolicy`
- **THEN** the returned endpoint carries the new `channels` together with the previously stored `types` and `retryPolicy`

#### Scenario: Function-shaped options stay off the read shape

- **WHEN** the host creates an endpoint with a `filter` predicate, a `transform`, callable `headers`, a `custom` retryPolicy, and an `http` override carrying a `fetch` implementation
- **THEN** the returned endpoint exposes no `filter` or `transform` field
- **AND** its `headers` and `retryPolicy` read back as `null`
- **AND** its `http` carries the other stored HTTP overrides but no `fetch` key

#### Scenario: Get of an unknown id throws EndpointNotFound

- **WHEN** the host calls `endpoints.get(id)` with an id that does not exist
- **THEN** it throws `EndpointNotFound` whose `code` is `ENDPOINT_NOT_FOUND`
- **AND** the value is discriminable via `instanceof PostelError` without matching the message string
