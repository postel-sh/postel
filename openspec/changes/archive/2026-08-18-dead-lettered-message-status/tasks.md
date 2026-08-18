## 1. Core types

- [x] 1.1 `storage/types.ts`: widen `MessageStatus` to `"pending" | "dispatched" | "dead-lettered" | "expired"` and `markMessageFinal`'s status parameter to match.

## 2. Finalization logic

- [x] 2.1 `sender/dispatcher/dispatch.ts`: track `anySuccess` / `anyDeadLetter` across the per-endpoint loop (both for outcomes dispatched this pass and for endpoints already terminal from a prior reservation via `latestByEndpoint`); when `!anyRetryable`, finalize `dead-lettered` if `anyDeadLetter && !anySuccess`, else `dispatched` as before.

## 3. Storage adapters (schema version only — `markMessageFinal` is a generic pass-through in all 8)

- [x] 3.1 `storage/memory/adapter.ts`: bump `SCHEMA_VERSION` to `6`.
- [x] 3.2 `storage/helpers/src/migrations.ts`: add a version-6 entry (schema_version bump only, no column DDL) to `SQLITE_MIGRATIONS`, `PG_MIGRATIONS`, and `MYSQL_MIGRATIONS`.

## 4. DB schema

- [x] 4.1 Add `specs/db-schema/0006_dead_lettered_message_status.sql` (schema_version bump; no column DDL — `messages.status` has no CHECK constraint).
- [x] 4.2 Update the `messages.status` inline vocabulary comment in `specs/db-schema/0001_init.sql` for future readers.

## 5. Tests

- [x] 5.1 `core/test/retry.test.ts`: update the two "cross-endpoint fanout with exhaustion" tests — both-endpoints-dead-letter now finalizes the message `dead-lettered`, not `dispatched`.
- [x] 5.2 `core/test/retry.test.ts`: add "Message finalized as dead-lettered on exhaustion" tests for the single-endpoint-exhausts and fanout-with-a-surviving-success scenarios.
- [x] 5.3 `core/test/message-introspection.test.ts`: add "Filter by dead-lettered status" test.
- [x] 5.4 `admin/test/admin-router.test.ts`: add a `GET /messages?status=dead-lettered` filter test.
- [x] 5.5 `core/test/storage.test.ts`: update the schema-version assertion to `6`.
- [x] 5.6 `storage/testkit/src/index.ts`: add a conformance case exercising `markMessageFinal(id, "dead-lettered")` + `listMessages({ status: "dead-lettered" })`, run against every adapter's suite.

## 6. Docs

- [x] 6.1 `docs/content/docs/outbound/messages.mdx`: add `"dead-lettered"` to the documented `message?.status` vocabulary snippet.

## 7. Verification

- [x] 7.1 Run `mise run check:all` at the repo root.
- [x] 7.2 Run the `@postel/core`, `@postel/admin`, `@postel/storage-helpers`, and all 8 storage-adapter packages' test/lint/typecheck/build chains.
