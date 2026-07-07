## MODIFIED Requirements

### Requirement: List and filter messages

The library SHALL provide a read that lists outbound messages, filterable by `tenantId`, event `type`(s), outbox `status`, and a `createdAt` time window (`since` / `until`). Results SHALL be returned newest-first as a bounded page — at most a caller-supplied `limit` items, with a conservative default limit applied when none is given — using opaque keyset cursor pagination rather than offset pagination. The page carries the messages and a `nextCursor`, which is `null` on the last page and otherwise an opaque token the caller passes back as `cursor` (alongside the same filters) to fetch the next page. A tenant-scoped caller SHALL see only that tenant's messages.

#### Scenario: Filter by type and time window

- **WHEN** the host calls `outbound.messages.list({ types: ['order.created'], since })` over a store holding mixed types and timestamps
- **THEN** the result's items contain only `order.created` messages created at or after `since`
- **AND** the messages are ordered newest-first

#### Scenario: Filter by outbox status

- **WHEN** the host calls `outbound.messages.list({ status: 'dispatched' })`
- **THEN** the result's items contain only messages whose outbox `status` is `dispatched`

#### Scenario: Tenant scoping restricts results

- **WHEN** the host calls `outbound.messages.list({ tenantId: 't_42' })`
- **THEN** only messages whose `tenantId` is `t_42` are returned

#### Scenario: Limit bounds the result count

- **WHEN** the host calls `outbound.messages.list({ limit: 2 })` over a store holding more than two messages
- **THEN** at most two messages are returned
- **AND** the page carries a non-null `nextCursor`

#### Scenario: Cursor pagination walks the full set without gaps or duplicates

- **WHEN** the host repeatedly calls `outbound.messages.list({ limit, cursor })`, starting with no cursor and feeding each page's `nextCursor` into the next call, over a store holding more messages than fit in one page
- **THEN** every message is returned exactly once across the pages, in newest-first order
- **AND** the final page's `nextCursor` is `null`
