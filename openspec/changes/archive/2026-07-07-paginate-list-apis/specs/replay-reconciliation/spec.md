## MODIFIED Requirements

### Requirement: Reconciliation API

The library SHALL provide `postel.reconcile({ endpointId, since, limit?, cursor? })` returning a bounded page of messages that were never confirmed delivered (eligible for nightly catch-up jobs). The result is at most `limit` message ids (a conservative default limit applies when none is given), oldest-first, together with a `nextCursor` — `null` when the backlog is exhausted, otherwise an opaque token the caller passes back as `cursor` to resume where the previous page ended. A reconcile over an arbitrarily large gap SHALL therefore never materialize the entire backlog in one unbounded result.

#### Scenario: Reconcile finds gaps

- **WHEN** the host calls `reconcile({ endpointId, since })` after a receiver outage
- **THEN** the result's items list messages whose latest attempt is in a non-delivered state

#### Scenario: Reconcile pages through a large backlog

- **WHEN** the host calls `reconcile({ endpointId, since, limit })` over a backlog larger than `limit`, then feeds each page's `nextCursor` back as `cursor`
- **THEN** each call returns at most `limit` message ids, oldest-first
- **AND** every undelivered id is returned exactly once across the pages, with the final page's `nextCursor` `null`
