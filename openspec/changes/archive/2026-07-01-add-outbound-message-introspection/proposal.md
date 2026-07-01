## Why

Postel can `send` / `replay` / `reconcile` and CRUD endpoints, but it cannot answer "what happened to message X?" — there is no way to read a message or its delivery attempts, even though storage already holds all of it (`NewAttempt`, response codes, latency, `AttemptStatus`). For a library whose pitch is *reliability*, delivery observability is core product, not an extra. This is also the blocker the `observability` capability names explicitly: its read/observability admin handlers are "deferred until the outbound surface exposes a message/attempt query API."

## What Changes

- **New outbound read surface** `postel.outbound.messages`:
  - `messages.get(id)` — the message (metadata + payload) or `undefined` when absent.
  - `messages.attempts(id)` — the ordered delivery-attempt history (status, response code, latency, error, per endpoint), including replay-tagged attempts.
  - `messages.list(filter)` — recent messages filtered by tenant, event type, outbox status, and time window, newest-first, bounded by a limit.
- **Storage read operations**: add `getMessage` and `listMessages` to the `Storage` interface (implemented across every adapter), plus a `decodeStoredMessage` helper in `@postel/storage-helpers`. Attempt reads reuse the existing `attempts.latestForMessage`.
- **Admin HTTP read routes** (unblocks the deferred observability handlers): `GET /messages` (list with filters), `GET /messages/:id` (get; `404` when absent), `GET /messages/:id/attempts`. Tenant scoping is authorize-derived, matching the existing control-plane routes. Framework mounts are unchanged (the router is a catch-all Web handler).

## Capabilities

### New Capabilities

- **`message-introspection`** — the outbound read/introspection contract: read a message, list its delivery attempts, and list/filter messages. The read OUTCOME (a message + its attempt history are retrievable) is CONTRACT; the TypeScript method surface (`messages.get` / `.attempts` / `.list`) is the port mechanism.

### Modified Capabilities

- **`api-surface-typescript`** — MODIFY *Postel factory returns the library instance* to add `messages.{get,attempts,list}` to the enumerated `postel.outbound` surface.
- **`storage-layer`** — MODIFY *BYO storage interface* to add `getMessage` and `listMessages` to the minimum operation set.
- **`observability`** — MODIFY *Admin HTTP handlers* to add the three read routes and drop the "deferred until a message/attempt query API exists" carve-out (that API now exists).

## Wire-format / DB-schema impact

Wire-format: unchanged (reads only; no signing or payload structure change). DB-schema: unchanged (reads existing `messages` / `attempts` columns; no new columns).

## Impact

- `@postel/core`: new public types `Message` / `DeliveryAttempt` / `MessageStatus` / `MessageListOptions`; `OutboundApi.messages`; new `Storage.getMessage` / `Storage.listMessages` + `StoredMessage` / `MessageListFilter` storage types. New exports from the package root.
- `@postel/storage-helpers`: `decodeStoredMessage`.
- Storage adapters (`memory`, `pg`, `sqlite`, `mysql`, `kysely`, `drizzle`, `prisma`, `typeorm`, `mikro-orm`): implement `getMessage` + `listMessages`; shared testkit battery gains coverage so every adapter is exercised.
- `@postel/admin`: three `GET` read routes; no framework-adapter change (catch-all forwarding).
- Docs + tests updated accordingly.
