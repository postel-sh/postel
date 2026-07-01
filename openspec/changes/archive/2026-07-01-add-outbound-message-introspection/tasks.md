# Tasks

## 1. Spec

- [x] 1.1 NEW `message-introspection` — *Read a message by id*, *List a message's delivery attempts*, *List and filter messages*.
- [x] 1.2 MODIFY `api-surface-typescript` *Postel factory returns the library instance* — add `messages.{get,attempts,list}` to the outbound surface.
- [x] 1.3 MODIFY `storage-layer` *BYO storage interface* — add `getMessage` + `listMessages` to the operation set.
- [x] 1.4 MODIFY `observability` *Admin HTTP handlers* — add the three read routes; drop the deferral note.

## 2. Storage

- [x] 2.1 `storage/types.ts`: `MessageStatus`, `StoredMessage`, `MessageListFilter`; `Storage.getMessage` + `Storage.listMessages`.
- [x] 2.2 `@postel/storage-helpers`: `decodeStoredMessage`.
- [x] 2.3 Implement `getMessage` + `listMessages` in every adapter: memory, pg, sqlite, mysql, kysely, drizzle, prisma, typeorm, mikro-orm (skip uncommitted rows on plain reads).
- [x] 2.4 Testkit battery: cover the introspection reads naming the `storage-layer` requirement.

## 3. Core public API

- [x] 3.1 `outbound.ts`: `Message`, `DeliveryAttempt`, `MessageStatus`, `MessageListOptions`; `OutboundApi.messages`; wire in `buildOutboundRuntime`.
- [x] 3.2 Export the new public types from `@postel/core` root.

## 4. Admin HTTP

- [x] 4.1 `@postel/admin`: `GET /messages`, `GET /messages/:id`, `GET /messages/:id/attempts` with authorize-derived tenant scoping and `MESSAGE_NOT_FOUND` → 404.

## 5. Tests + docs

- [x] 5.1 core `message-introspection.test.ts` (get existing/missing; attempts ordered w/ status/code/latency; replay tag; list by type/time/status/tenant/limit).
- [x] 5.2 api-surface + admin read-route tests (outbound read surface present; read message + attempts; unknown → 404; list with filters; tenant scoping).
- [x] 5.3 Docs: outbound introspection page + admin read routes; reference touch-ups.

## 6. Verify + archive

- [x] 6.1 `openspec validate add-outbound-message-introspection`; per-package `turbo run typecheck test lint`; `mise run docs:typecheck`.
- [x] 6.2 `openspec archive add-outbound-message-introspection -y`; `mise run check:all`.
- [x] 6.3 PR referencing #80 and the `message-introspection` capability.
