# Pin keyset-cursor invariants: ms precision, id total order, validated dates

## Why

An adversarial audit of the pagination envelope (#84 / PR #107) reproduced three gaps the spec left implicit: (1) the opaque cursor encodes millisecond ISO-8601 while `timestamptz` columns hold microseconds, so any sub-ms stored value silently drops rows from paginated walks (reproduced on pglite); (2) MySQL's case-insensitive default collation makes distinct mixed-case ids compare equal, breaking the keyset id tie-break at page boundaries; (3) `reconcile`'s `since` was unvalidated — a garbage date silently returned the full backlog on the memory adapter and 500'd on SQL adapters.

## What Changes

- **`storage-layer`** — MODIFY *BYO storage interface*: state the two keyset invariants as part of the pagination convention — keyset-ordered `createdAt` columns are stored at exactly millisecond precision (enforced by schema: `timestamptz(3)` / epoch-ms / ms ISO text), and id tie-break comparison is a deterministic total order with byte order as the canonical cross-port ordering (MySQL pins a binary collation).
- **`replay-reconciliation`** — MODIFY *Reconciliation API*: a malformed `since` is a structured caller error, never a silent full-backlog read.
- **`observability`** — MODIFY *Admin HTTP handlers*: malformed `since` / `until` dates on `POST /reconcile` and `POST /replay` respond `400 INVALID_QUERY`, matching `GET /messages`.

## Capabilities

### Modified Capabilities

- **`storage-layer`** — keyset precision + id-ordering invariants added to *BYO storage interface*.
- **`replay-reconciliation`** — malformed-`since` rejection added to *Reconciliation API*.
- **`observability`** — date validation on the replay/reconcile admin routes added to *Admin HTTP handlers*.

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: the canonical Postgres DDL pins `timestamptz(3)` on the keyset-ordered `created_at` columns (tenants, endpoints, messages), and the MySQL dialect pins `DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin` on every table — both applied to `specs/db-schema/0001_init.sql` and the `@postel/storage-helpers` migrations in the same PR (pre-1.0, same-milestone schema; no released deployment exists to migrate).

## Impact

- ADR 0015 records both invariants for the ports.
- `@postel/storage-helpers` migrations updated; adapters' reconcile reworked to a single bounded query (implementation detail of the existing bounded-page requirement, not a spec change).
- `reconcileImpl` / `replayImpl` validate dates; admin routes map malformed dates to 400.
