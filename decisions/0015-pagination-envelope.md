# 0015 — Pagination envelope for list-returning APIs

- **Status**: Accepted
- **Date**: 2026-07-07
- **Decision drivers**: 1.0 contract freeze (retrofitting pagination is a breaking return-shape change), cross-port consistency, protection against unbounded reads over production-sized tables

## Context

Postel exposes several list-returning reads: `endpoints.list`, `messages.list`, `tenants.list`, `reconcile`, and their admin HTTP projections (`GET /endpoints`, `GET /messages`, `GET /tenants`, `POST /reconcile`). Before this decision, only `tenants.list` (issue #82) was paginated; the rest returned unbounded arrays — `reconcile` could materialize every missed message id from an arbitrarily long outage in one response. Because a return-shape change is breaking, the envelope must be uniform and frozen before 1.0 (issue #84).

## Decision

Every list-returning read — public API and admin HTTP alike, in every port — is bounded and paginated with one convention, the one `tenants.list` established:

- **Input**: an optional `limit` (positive integer) and an optional opaque `cursor`. When `limit` is omitted, a conservative default of **100** applies. Unbounded-by-default does not exist.
- **Output**: a page carrying the items plus a `nextCursor` continuation token. `nextCursor` is `null` when the set is exhausted, otherwise an opaque string the caller passes back as `cursor` to fetch the next page. In the TypeScript port this is `Page<T> { items, nextCursor }` with `CursorOptions { limit?, cursor? }`.
- **Cursor mechanics**: keyset pagination over `(createdAt, id)` — never offset pagination, which skews under concurrent writes and degrades on large tables. The reference encoding is base64url of `"${createdAtISO} ${id}"`. Cursors are opaque to callers: no format guarantee, no cross-surface reuse, no ordering arithmetic.
- **Ordering**: newest-first (`createdAt DESC, id DESC`) for the observability-shaped lists (endpoints, messages, tenants); oldest-first (`createdAt ASC, id ASC`) for `reconcile`, whose consumers drain a backlog forward.
- **Errors**: a cursor that cannot be decoded is a structured caller error (TypeScript: `TypeError`; admin HTTP: `400` `INVALID_QUERY`), never silently ignored. A non-positive or non-integer `limit` is likewise rejected (`RangeError` / `400`).
- **Admin HTTP shape**: list routes respond with the matching plural key plus `nextCursor` — `{ endpoints, nextCursor }`, `{ messages, nextCursor }`, `{ tenants, nextCursor }`, `{ messageIds, nextCursor }` — and accept `?limit=` / `?cursor=` (query) or `limit` / `cursor` (JSON body for `POST /reconcile`).

## Conformance

The bounded-with-cursor-continuation OUTCOME is CONTRACT (per [ADR 0008](0008-conformance-levels.md)): no conformant port may return an unbounded list from these surfaces, every port applies the default limit, and every port signals exhaustion with a null continuation. The `Page<T>` / `CursorOptions` type names and the base64url `(createdAt, id)` cursor encoding are the TypeScript-port mechanism; other ports MAY choose their own idioms (e.g. Go iterators with a resume token) as long as the outcome holds and their admin HTTP projection keeps the JSON shapes above, which are CONTRACT.

## Consequences

- All list reads are safe against production-sized tables by default; callers opt into larger pages explicitly.
- Adding pagination later to a new list surface is not breaking — shipping one without it is, so new list-returning APIs MUST adopt this envelope from their first release.
- The keyset columns (`created_at`, `id`) already exist and are index-friendly; no schema change is required.
