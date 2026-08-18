## Why

The polyglot contract ("Every port conforms to the same wire format, DB schema") has a hole on the receiver side: `postel_received_messages` (the idempotency dedup table) exists only as ad-hoc DDL inside each TypeScript dedup adapter's `ensure*DedupTable`, with no entry in `specs/db-schema/0001_init.sql` or any numbered migration. A Go or Python port author has no normative shape to implement against.

## What Changes

- Add the canonical `postel_received_messages` DDL as a new numbered migration (`specs/db-schema/0007_received_messages_dedup_table.sql`), Postgres dialect with SQLite and MySQL variants commented inline.
- Align the two SQL `Storage` adapters missing the `expires_at` index on their ad-hoc dedup table (`pg`, `sqlite`) to match the shape their standalone dedup-adapter siblings (`PgDedup`, `SqliteDedup`) already create.
- Add a shared canonical-column assertion to `@postel/storage-testkit`, used by the `pg`, `sqlite`, and `mysql` dedup test suites to guard against future drift from the documented shape.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `storage-layer`: MODIFIED "Schema is a fixed set of canonical tables" — adds `postel_received_messages` to the fixed table list and a new scenario asserting its canonical shape. The `receiver` capability's "Idempotency dedup helper" requirement (behavior: `{ duplicate: boolean }`, TTL semantics, first-party adapter list) is unchanged; only the previously-undocumented storage shape backing it is now normative.

## Wire-format / DB-schema impact

Wire-format: unchanged (dedup state is never carried on the wire). DB-schema: modified — new canonical `postel_received_messages` table + `expires_at` index, added via `db-schema-delta.sql`.

## Impact

- `specs/db-schema/`: new `0007_received_messages_dedup_table.sql`.
- `@postel/pg`: `src/storage.ts` gains the `expires_at` index on its ad-hoc dedup table.
- `@postel/sqlite`: `src/storage.ts` gains the `expires_at` index on its ad-hoc dedup table.
- `@postel/storage-testkit`: new exported canonical column list for `postel_received_messages`.
- `@postel/pg`, `@postel/sqlite`, `@postel/mysql`: each dedup test suite gains one assertion against the canonical shape.
