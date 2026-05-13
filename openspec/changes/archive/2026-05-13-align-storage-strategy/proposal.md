# Proposal — align storage-layer capability with the storage-strategy ADR

## Why

The `storage-layer` capability spec was authored against an earlier framing where Postel was assumed to own its own DB connection (a single "Postgres adapter", a single "SQLite adapter", and a BYO `Storage` interface modeled as `(transactions, locks, queries)`). [Decision 0007 (Storage strategy)](../../../decisions/0007-storage-strategy.md), accepted as part of consolidating the earlier 0004/0008/0009 drafts, replaces that framing with an **adapter matrix** where the host's existing DB access layer is the execution context. This change reconciles the capability spec with the accepted decision.

The substantive shift the spec needs to reflect:

- There is no single "Postgres adapter" — Postgres is a target database with multiple adapter categories (standalone, client-wrapping, ORM-wrapping).
- The host's transaction handle flows into Postel's writes via an optional `tx` argument, so the outbox insert participates in the host's unit of work.
- The BYO `Storage` interface is operation-shaped (`reserveBatch`, `recordAttempt`, `dedup`, …), not CRUD-shaped. Operations capture the semantics that CRUD can't (`FOR UPDATE SKIP LOCKED` with lease, atomic insert-or-reuse, streaming range queries).
- Schema is delivered differently per adapter category: SQL migrations for standalone/client adapters; native schema fragments for ORM adapters (Drizzle export, Prisma fragment).

## What Changes

- **MODIFIED** `Postgres adapter is the primary backend` → renamed and reframed as `Postgres support across the adapter matrix`.
- **MODIFIED** `SQLite adapter with feature parity except listen/notify` → renamed and reframed as `SQLite support across the adapter matrix`.
- **MODIFIED** `BYO storage interface` → tightened to specify the operation-shaped, technology-agnostic contract and the host-transaction passthrough mechanism.
- **MODIFIED** `Migrations bundled in the library` → expanded to cover the per-adapter-category schema delivery model.
- **ADDED** `Adapter matrix with three categories` — standalone / client / ORM.
- **ADDED** `Host transaction passthrough` — every write accepts an optional `tx` argument.
- **ADDED** `Optional storage capabilities` — adapters declare a `capabilities` flag so consumers can degrade gracefully (e.g., polling instead of `LISTEN`/`NOTIFY` when `notify` is unsupported).

Unchanged requirements: `Tenant-scoped row-level access in queries`, `Schema is a fixed set of canonical tables`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `storage-layer` — 4 MODIFIED + 3 ADDED requirements. No removals.

## Wire-format / DB-schema impact

- **Wire format**: unchanged.
- **DB schema**: unchanged. The canonical DDL stays as the source of truth; what changes is how each adapter delivers it (raw SQL migrations vs ORM schema fragments).

## Impact

- **Code**: none yet (pre-implementation). The first storage adapter implementation lands on top of these refined requirements.
- **Compliance suite**: gains adapter-category coverage as part of its own implementation — every adapter must pass the same suite.
- **Distribution-packaging spec**: a follow-up change adds the Tier 1 adapter packages (`@postel/standalone-pg`, `@postel/standalone-sqlite`, `@postel/drizzle`, `@postel/prisma`, `@postel/kysely`) to the package list.
- **Stakeholders**: maintainer, future TS port contributors, future polyglot port authors (the matrix pattern carries across languages).
