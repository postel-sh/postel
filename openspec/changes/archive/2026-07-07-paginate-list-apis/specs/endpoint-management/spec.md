## MODIFIED Requirements

### Requirement: Endpoint CRUD

The library SHALL expose `postel.endpoints.create`, `update`, `disable`, `delete`, `list`, `get`. Create accepts `{ url, types?, channels?, filter?, transform?, retryPolicy?, headers?, signing? }` and returns the created endpoint with a generated id. `list` returns a bounded, paginated page rather than an unbounded array (see *List endpoints (paginated)*). A read (`get`) or URL-affecting `update` targeting an id that does not exist SHALL throw the typed `EndpointNotFound` error (`code: ENDPOINT_NOT_FOUND`), never a plain `Error` discriminated by message string — so callers (including the admin HTTP router) can map it to `404` via class identity per the `api-surface-typescript` *No string matching on errors* requirement.

#### Scenario: Create and retrieve

- **WHEN** the host calls `endpoints.create({ url, types: ['order.*'] })`
- **THEN** the call returns an endpoint with a stable id
- **AND** `endpoints.get(id)` returns the same endpoint

#### Scenario: Get of an unknown id throws EndpointNotFound

- **WHEN** the host calls `endpoints.get(id)` with an id that does not exist
- **THEN** it throws `EndpointNotFound` whose `code` is `ENDPOINT_NOT_FOUND`
- **AND** the value is discriminable via `instanceof PostelError` without matching the message string

## ADDED Requirements

### Requirement: List endpoints (paginated)

The library SHALL provide a read that lists endpoints newest-first (by creation time), bounded by a caller-supplied `limit` with a conservative default applied when none is given, using opaque keyset cursor pagination rather than offset pagination. The read returns a page carrying the endpoints and a `nextCursor`, which is `null` on the last page and otherwise an opaque token the caller passes back as `cursor` to fetch the next page. The optional `tenantId` filter composes with pagination: a tenant-scoped list pages over only that tenant's endpoints.

#### Scenario: Limit bounds the page size

- **WHEN** the host calls `outbound.endpoints.list({ limit: 2 })` over a store holding more than two endpoints
- **THEN** at most two endpoints are returned in the page, newest-first
- **AND** the page carries a non-null `nextCursor`

#### Scenario: Cursor pagination walks the full set without gaps or duplicates

- **WHEN** the host repeatedly calls `outbound.endpoints.list({ limit, cursor })`, starting with no cursor and feeding each page's `nextCursor` into the next call, over a store holding more endpoints than fit in one page
- **THEN** every endpoint is returned exactly once across the pages, in newest-first order
- **AND** the final page's `nextCursor` is `null`

#### Scenario: Empty store returns an empty page

- **WHEN** the host calls `outbound.endpoints.list()` over a store holding no endpoints
- **THEN** the result's items list is empty and `nextCursor` is `null`
