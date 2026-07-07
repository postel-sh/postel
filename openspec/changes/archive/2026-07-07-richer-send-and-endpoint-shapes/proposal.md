# Richer send() and endpoint shapes

## Why

Two public reads discard data the library already holds, and both shapes freeze at the M3 contract freeze (issue #83). `send()` returns a bare `MessageId` even though storage reports whether an idempotency key matched an existing row — callers cannot tell "accepted" from "deduplicated". And the public `Endpoint` projects the stored record down to `{ id, url, state, tenantId?, metadata? }`, so `create`/`get`/`list`/`update` lose `types`, `channels`, `retryPolicy`, `createdAt`, and every other accepted field on the way out.

## What Changes

- **BREAKING** `outbound.send()` resolves to a `SendResult { id, reused }` instead of a bare `MessageId`. `reused` is `true` only when an idempotency key matched an existing outbox row; non-idempotent sends always report `reused: false`.
- **BREAKING** the public `Endpoint` returned by `endpoints.create/get/list/update` carries every accepted serializable field: `types`, `channels`, `retryPolicy`, `allowHttp`, `maxInflight`, `http`, `circuitBreaker`, `autoDisable`, `createdAt`, `updatedAt`, and `headers` when (and only when) headers were provided as a plain record. Function-shaped options (`filter`, `transform`, callable `headers`) are code-side JS values, not serializable data — they stay off the public read shape. `signing` also stays off the read shape (it can carry key material).
- `@postel/admin` endpoint routes return the richer body automatically (they pass `Endpoint` straight through); `Date` fields JSON-serialize as ISO strings.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`sender`** — RENAME *Send is non-blocking and returns a MessageId* to *Send is non-blocking and returns a SendResult* and rewrite it around the `{ id, reused }` result; MODIFY *Idempotent send by client-supplied key* so the duplicate call returns the same `id` with `reused: true`.
- **`endpoint-management`** — MODIFY *Endpoint CRUD* to require the full serializable round-trip on create/get/list/update and to state the function-shaped-field exclusion; MODIFY *Per-endpoint metadata field* to anchor metadata in that same round-trip shape.
- **`compliance`** — MODIFY *v0.2.0 sender-side initial test scope* only to track the renamed `sender` requirement title in its coverage table (no vector semantics change; `/control/send` still answers `{ messageId }`).

## Wire-format / DB-schema impact

Wire-format: unchanged — the delivery wire (headers, signatures, payload) is untouched; this changes the host-facing library API only. DB-schema: unchanged — both results are projections of columns that already exist.

## Impact

- `@postel/core`: new exported `SendResult` type; `OutboundApi.send` return type; `sendImpl` stops discarding `InsertOrReuseResult.reused`; `toPublicEndpoint` projects the full record; enriched `Endpoint` interface.
- `@postel/compliance-driver`: `/control/send` handler destructures `id` from the new result (response body unchanged).
- `@postel/admin`: no code change; responses and tests now carry the richer endpoint body.
- Tests and docs (`outbound/send`, `outbound/endpoints`, quickstart, storage send examples, landing page) updated to the new shapes.
