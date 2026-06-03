## MODIFIED Requirements

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
