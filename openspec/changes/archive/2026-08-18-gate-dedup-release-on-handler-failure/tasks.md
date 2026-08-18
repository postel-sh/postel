# Tasks

## 1. Spec

- [x] 1.1 receiver: MODIFY *Framework adapters offer optional dedup-acknowledgement* (release-on-failure, release-capable-adapter conformance note, new scenarios).

## 2. @postel/core

- [x] 2.1 `DedupAdapter.release?(messageId): Promise<void>` in `types.ts`.
- [x] 2.2 `InMemoryDedup` (`strategies/dedup.ts`) implements `release`.
- [x] 2.3 `InboundSourceApi` / `buildSourceApi` (`inbound.ts`) exposes a bound `dedupRelease(messageId)` alongside `dedup` when the source has a dedup adapter.

## 3. @postel/http

- [x] 3.1 `GateSource.dedupRelease?(messageId): Promise<void>` in `types.ts`.
- [x] 3.2 `handleInbound` wraps the `onVerified` call: on a fresh (non-duplicate) record, catch a handler throw, best-effort `await source.dedupRelease?.(messageId)`, then rethrow unchanged.

## 4. Storage adapters

- [x] 4.1 `PgDedup` (`storage/pg/src/dedup.ts`): `release` deletes the row by `message_id`.
- [x] 4.2 `SqliteDedup` (`storage/sqlite/src/dedup.ts`): `release` deletes the row by `message_id`.
- [x] 4.3 `MysqlDedup` (`storage/mysql/src/dedup.ts`): `release` deletes the row by `message_id`.

## 5. Tests + docs

- [x] 5.1 `@postel/core`: unit test for each first-party adapter's `release` (record → release → record again returns `duplicate: false`).
- [x] 5.2 `@postel/http` (`dedup-ack.test.ts`): handler-throw releases the record and a retry reaches the handler again; release runs only for the request that recorded (not for an already-duplicate request); a `release`-less adapter preserves today's behavior.
- [x] 5.3 Docs: `docs/content/docs/inbound/deduplication.mdx` — "Delivery semantics of gate-level dedup" section (ordering, release-on-failure, concurrent-duplicate trade-off).

## 6. Verify + archive

- [x] 6.1 `mise run check:all`; per-package test/lint/build for `core`, `http`, `storage/pg`, `storage/sqlite`, `storage/mysql`; `mise run docs:typecheck`.
- [x] 6.2 `openspec archive gate-dedup-release-on-handler-failure -y`; open PR referencing `receiver` capability and closing #129.
