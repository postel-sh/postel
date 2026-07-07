# Tasks

## 1. Spec

- [x] 1.1 MODIFY `storage-layer` *BYO storage interface* — ms-precision and id-total-order keyset invariants.
- [x] 1.2 MODIFY `replay-reconciliation` *Reconciliation API* — malformed `since` rejected.
- [x] 1.3 MODIFY `observability` *Admin HTTP handlers* — malformed dates on replay/reconcile → 400.
- [x] 1.4 ADR 0015 — record both invariants.

## 2. Schema

- [x] 2.1 `specs/db-schema/0001_init.sql` + PG migrations: `timestamptz(3)` on keyset-ordered `created_at` columns.
- [x] 2.2 MySQL migrations: `DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin` on every table.

## 3. Implementation

- [x] 3.1 `reconcileImpl` / `replayImpl`: NaN-date guards; admin routes → 400 INVALID_QUERY.
- [x] 3.2 Rework adapter reconcile to one bounded query (LIMIT + NOT EXISTS latest-success probe).
- [x] 3.3 Admin `invalidCursor` gated on a cursor actually being supplied; empty `?cursor=` rejected again.

## 4. Tests

- [x] 4.1 pglite regression: sub-ms `created_at` nudge no longer loses rows (timestamptz(3) rounds).
- [x] 4.2 Testkit: same-`createdAt` mixed-case-id page-boundary walk (messages + endpoints).
- [x] 4.3 Core: multi-page `publicJwks` (> one page of endpoints); malformed reconcile `since` rejected.

## 5. Verify + archive

- [x] 5.1 `openspec validate pin-keyset-cursor-invariants --strict`; full TS chain incl. Docker-gated MySQL tiers.
- [x] 5.2 `openspec archive pin-keyset-cursor-invariants -y`; `mise run check:all`.
