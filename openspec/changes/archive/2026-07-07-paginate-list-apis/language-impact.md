# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | Every list-returning read (`endpoints.list`, `messages.list`, `reconcile`, plus the admin `GET /endpoints` / `GET /messages` / `POST /reconcile` projections) now returns the bounded `{ items, nextCursor }` page `tenants.list` established, instead of an unbounded array. Reads only — no dispatch/signing change. |
| typescript-receiver | unchanged | Inbound verify/dedup untouched. |
| go-sender (planned) | unchanged | The CONTRACT outcome for any future sender port: list-returning reads are bounded by default, resumable via an opaque cursor, and signal exhaustion with a null continuation. The `Page<T>` / `CursorOptions` type names, the base64url `(createdAt, id)` cursor encoding, and the `Storage` operation shapes are TypeScript-port mechanisms; other ports MAY surface pagination through their own idioms (see ADR 0015). |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Same as go-sender. |
| python-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | Same as go-sender. |
| rust-receiver (planned) | unchanged | |
| wire-format | unchanged | Reads and admin JSON bodies only; no webhook wire change. |
| db-schema | unchanged | Keyset cursors use the existing `created_at` + `id` columns; no new columns or indexes. |

## Lockstep / lag

The CONTRACT addition is the bounded-list OUTCOME: no list-returning public or admin read may return an unbounded result; every one applies a conservative default limit and exposes cursor continuation with a null terminator. Ports MAY lag until they implement a sender, but a port claiming sender parity SHALL bound its list reads the same way. The cursor encoding and the TS `Page<T>` shape are reference-implementation mechanisms a port MAY vary (ADR 0015).
