# 0004 — Postgres and SQLite as first-class backends; others via adapter

- **Status**: accepted
- **Date**: 2026-05-09
- **Decision drivers**: NFR-C-3, NFR-C-4, SR-1, SR-2, SR-3, target-stack reach

## Context

Webhook delivery has two persistent-storage requirements: an outbox queue with row-level locking semantics, and structured event/attempt history. The library targets two distinct ecosystems:

- **Server-side** stacks (Node, Bun, Deno) where Postgres dominates.
- **Single-binary OSS** stacks (Plausible, Pocketbase, Cal.com) where SQLite dominates.

Other relational stores (PlanetScale, CockroachDB, libSQL/Turso, MySQL) are increasingly common but each has its own quirks (no `FOR UPDATE SKIP LOCKED` semantics, transactional model differences, dialect drift).

## Decision

The library ships first-party adapters for **Postgres ≥ 14** and **SQLite ≥ 3.40**. Other stores connect via a documented `Storage` interface (transactions, locks, queries) that the host implements.

- Postgres is the primary backend with the full feature set (`FOR UPDATE SKIP LOCKED`, `LISTEN`/`NOTIFY`, JSONB, `RETURNING`).
- SQLite has feature parity except no listen/notify (workers poll). Single-writer constraints are documented.
- The BYO adapter interface is stable across minor versions and is the supported extension point for community-maintained adapters.

## Consequences

- We own correctness for Postgres and SQLite end-to-end; community adapters carry their own correctness ownership.
- Schema migrations target Postgres dialect with SQLite variants commented inline.
- Performance benchmarks are published against Postgres (the throughput target is on the Postgres adapter).

## Alternatives considered

- **Postgres only** — rejected. Excludes the OSS single-binary persona.
- **Add MySQL as first-party** — deferred. Extension mechanism (BYO `Storage`) exists if a community-maintained MySQL adapter emerges.
- **NoSQL outbox** — rejected. Outbox semantics (transactional insert with host writes, row locks) require relational guarantees.
