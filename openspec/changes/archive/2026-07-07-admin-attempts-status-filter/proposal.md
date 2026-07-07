# Proposal: admin-attempts-status-filter

## Why

Issue #81 asks for admin read routes for messages and attempts "with status filters". PR #100 (#80) already shipped `GET /messages`, `GET /messages/:id`, and `GET /messages/:id/attempts` on the admin router, tenant-scoped and built on the public introspection API — everything in #81's acceptance except the status filter on the attempts route. A deliveries dashboard drilling into a message wants "show me the failures" without client-side filtering; today the route returns the full history only.

## What Changes

- **`GET /messages/:id/attempts` accepts a `?status=` filter** (repeatable and/or comma-separated, matching attempt delivery statuses such as `success`, `failed`, `dead-letter`) and returns only matching attempts, still ordered by `attemptNumber`.
- The filter is applied **in the admin router over the public `outbound.messages.attempts(id)` read** — a message's attempt history is small and bounded (retry schedule × endpoints), so the HTTP projection filters it rather than widening the introspection API and the storage contract.
- Unknown status values simply match nothing — the same convention as `GET /messages?status=`, which does not validate status values either.

## Capabilities

### Modified Capabilities

- **`observability`** — MODIFY *Admin HTTP handlers*: the attempts route gains the `?status=` filter, plus a scenario *Filter attempts by status via admin router*.

`message-introspection` is unchanged: `outbound.messages.attempts(id)` keeps returning the full history; filtering is an HTTP-projection concern.

## Wire-format / DB-schema impact

None. A query parameter on an existing admin read route; no new columns, no wire-format change.

## Impact

- `@postel/admin`: parse `?status=` in the attempts branch and filter the result. No framework-adapter change (catch-all forwarding).
- Docs: note the filter on the admin route table and the introspection page's HTTP-projection sentence.
