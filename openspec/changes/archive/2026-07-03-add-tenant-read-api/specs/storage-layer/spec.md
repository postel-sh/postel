## MODIFIED Requirements

### Requirement: BYO storage interface

The library SHALL document and stabilize a `Storage` interface that every adapter — first-party and third-party — implements. The interface MUST be technology-agnostic (a third-party author MUST NOT need to import any library-internal SQL builder or ORM to implement it), operation-shaped (not CRUD-shaped), and stable across minor versions.

The operation set MUST include at minimum: `insertMessage`, `insertOrReuseByIdempotencyKey`, `reserveBatch`, `recordAttempt`, `releaseLease`, `expireStaleLeases`, `loadEndpointsForMessage`, `rangeQuery` (as a streaming iterable), `reconcile`, `dedup`, `transaction(cb)`, the introspection reads `getMessage` and `listMessages`, and endpoint / secrets / tenant sub-namespaces. The tenant sub-namespace additionally includes the reads `tenants.get` (which accepts the standard host-transaction option, like the other read/write tenant operations) and `tenants.list` (paginated). `notify` and `subscribe` are optional capabilities (see `Optional storage capabilities` below).

`getMessage(id)` returns a single stored message (metadata + payload + outbox status) by id, or an absent result when none matches. `listMessages(filter)` returns a bounded, newest-first list of stored messages filtered by tenant, event type(s), outbox status, and a created-at window. Both back the `message-introspection` capability's read surface; per-message attempt history is read through the existing `attempts` sub-namespace.

`tenants.get(tenantId)` returns a single tenant record by id, or an absent result when none matches. `tenants.list(filter)` returns a bounded, newest-first page of tenant records using opaque keyset-cursor pagination (`{ limit?, cursor? }` in, `{ items, nextCursor }` out) rather than offset pagination. Both back the `multi-tenancy` capability's tenant-read requirements.

#### Scenario: Custom adapter against an unsupported backend

- **WHEN** a user implements the `Storage` interface for libSQL / Turso / D1 / CockroachDB / PlanetScale or any other backend, and configures Postel to use it
- **THEN** all sender / receiver / replay APIs work against the custom backend without any library code changes
- **AND** the adapter passes the `@postel/compliance` test suite without modification

#### Scenario: Worker reservation can't be expressed as CRUD

- **WHEN** an adapter author looks for a CRUD-shaped method equivalent to `reserveBatch`
- **THEN** none exists — `reserveBatch` is an operation that combines lock acquisition, lease assignment, and row return atomically
- **AND** the spec documents why (`FOR UPDATE SKIP LOCKED` with lease semantics doesn't decompose into pure CRUD)

#### Scenario: Introspection reads return a message and its attempts

- **WHEN** a message has been inserted and attempted, and a caller invokes `getMessage(id)` then `attempts.latestForMessage(id)`
- **THEN** `getMessage` returns the stored message with its outbox `status` and payload
- **AND** the attempt read returns the recorded attempts for that message
- **AND** `listMessages({ tenantId })` returns that message when scoped to its tenant

#### Scenario: Tenant reads return a record and a paginated page

- **WHEN** a tenant has been upserted, and a caller invokes `tenants.get(id)` then `tenants.list({ limit: 10 })`
- **THEN** `tenants.get` returns the tenant record
- **AND** `tenants.list` returns a page whose `items` contains that tenant and whose `nextCursor` is `null` when fewer than 10 tenants exist in the store
