# 0007 — Storage strategy: adapter matrix and host-transaction interop

- **Status**: Accepted
- **Date**: 2026-05-11
- **Supersedes**: the previously-separate `0004-postgres-and-sqlite-only`, `0008-storage-abstraction`, and `0009-byo-storage-interface` drafts. Nothing shipped against those; they are consolidated here.
- **Decision drivers**: outbox-pattern correctness, **host-transaction interop** (the biggest single win), edge-runtime support, ecosystem fit (work with whatever DB layer the host already uses), polyglot port portability

## Context

Postel needs persistent storage for the **transactional outbox** (every `send()` insert wrapped in the host's transaction; workers reserve rows under `FOR UPDATE SKIP LOCKED` and dispatch them) and the **audit trail** (attempts, replay history, endpoint state transitions). The canonical schema is at [`specs/db-schema/0001_init.sql`](../specs/db-schema/0001_init.sql).

Three earlier sub-decisions framed this poorly:

1. **Which databases are first-class?** (Postgres + SQLite, with BYO for everything else.)
2. **What SQL tool do we use internally?** (Kysely, on the assumption that "internal" meant "Postel owns a SQL connection".)
3. **What contract do third-party adapters implement?** (An operation-shaped `Storage` interface.)

The Kysely-as-internal-tool framing was wrong. It implied Postel owns a connection, separate from the host's DB layer. That breaks the entire outbox value proposition: if the host uses Drizzle (or Prisma, or pg directly) and Postel uses a separate connection, the host **cannot** wrap a `send()` call in their own transaction. The library and the host become two disjoint database citizens. No atomicity, no composition.

[Better Auth](https://better-auth.com/docs/adapters/postgresql) solved this elegantly: ship a matrix of adapters, each one wrapping the host's existing DB client. The host hands Postel their `db` instance (or transaction inside `db.transaction(...)`), and Postel uses it. Single connection, single transaction, single mental model.

## Decision

Postel ships an **adapter matrix** in which the host's existing database access layer is the execution context. Each adapter is a thin shim that implements the shared `Storage` interface using whatever client the host already runs.

### Three adapter categories

| Category | Examples | Postel owns connection? | When to use |
|---|---|---|---|
| **Standalone** | `@postel/standalone-pg`, `@postel/standalone-sqlite` | Yes | Hosts who don't yet have a DB layer; demos; the simplest "drop it in" path |
| **Client** | `@postel/pg` (node-postgres), `@postel/postgres-js`, `@postel/better-sqlite3` | No — host hands us a pool/client | Hosts using raw SQL drivers but no query builder/ORM |
| **Query-builder / ORM** | `@postel/kysely`, `@postel/drizzle`, `@postel/prisma` | No — host hands us their `db` or `tx` | The majority — hosts already running Drizzle/Prisma/Kysely against their DB |

A host running Drizzle does this:

```ts
import { postelDrizzle } from '@postel/drizzle';
import { db } from './db';

const postel = Postel({ adapter: postelDrizzle(db) });

// Outbox insert participates in the host's transaction — for free:
await db.transaction(async (tx) => {
  await tx.insert(orders).values({ /* ... */ });
  await postel.send({ type: 'order.created', data: { /* ... */ } }, { tx });
});
```

`tx` flows through `send()`, the adapter sees it instead of `db`, the row commits or rolls back with the host's work. No coordination, no extra connection, no driver mismatch.

### The shared `Storage` interface

Every adapter implements the same operation-shaped contract (sketch — refined during implementation):

```ts
interface Storage {
  // Outbox (transactional with host)
  insertMessage(msg: NewMessage, opts?: { tx?: HostTx }): Promise<MessageId>;
  insertOrReuseByIdempotencyKey(msg: NewMessage, opts?: { tx?: HostTx }): Promise<{ id: MessageId; reused: boolean }>;

  // Worker reservation (the SKIP-LOCKED equivalent)
  reserveBatch(opts: { workerId: string; leaseMs: number; batchSize: number; tenantFilter?: TenantId }): Promise<ReservedMessage[]>;
  recordAttempt(attempt: NewAttempt, opts?: { tx?: HostTx }): Promise<void>;
  releaseLease(messageId: MessageId): Promise<void>;
  expireStaleLeases(now: Date): Promise<number>;

  // Late-binding fanout
  loadEndpointsForMessage(messageId: MessageId): Promise<EndpointWithSecrets[]>;

  // Endpoint CRUD + state machine
  endpoints: { create, update, transitionState, list, get };
  secrets: { rotate, listForEndpoint };

  // Replay / reconciliation (streaming for large ranges)
  rangeQuery(filter: MessageFilter): AsyncIterable<Message>;
  reconcile(filter: ReconcileFilter): AsyncIterable<UnconfirmedMessage>;

  // Multi-tenancy
  tenants: { delete(tenantId: TenantId): Promise<void> };

  // Idempotency dedup (receiver-side)
  dedup(messageId: string, opts: { ttlSeconds: number }): Promise<{ duplicate: boolean }>;

  // Transactions (when the host hasn't already opened one)
  transaction<R>(cb: (tx: HostTx) => Promise<R>): Promise<R>;

  // Optional capabilities (PG has them, libSQL/D1/SQLite don't)
  notify?(channel: string, payload?: string): Promise<void>;
  subscribe?(channel: string, handler: (payload: string) => void): Unsubscribe;

  // Metadata
  capabilities: StorageCapabilities;
  schemaVersion(): Promise<number>;
}
```

The interface is **operation-shaped, not CRUD-shaped**. Operations like `reserveBatch` (UPDATE-with-lock-and-lease, atomic) can't be expressed as a CRUD `update` without losing semantics. This is the only place Postel's behavioral richness leaks into the storage layer — and it's where it needs to.

### Host transaction passthrough

Every write operation accepts an optional `tx` (the host's transaction handle, whatever shape their client uses). The adapter is responsible for unwrapping the host's tx and using it for the underlying call. This is the same pattern Better Auth uses.

For operations that span multiple writes and aren't wrapped by the host, Postel exposes `storage.transaction(cb)` — a thin pass-through to the host's transaction primitive. Adapters that can't do real transactions (rare; libSQL today is one example) provide a sequential-execution shim and declare `capabilities.transactional = false`; the worker logic degrades gracefully.

### Schema management per adapter

Each adapter category handles schema differently:

- **Standalone adapters**: ship SQL migrations bundled in the package. `postel.migrate(db)` is idempotent, safe on every boot.
- **Client adapters**: same SQL migrations; the host's pool/client runs them.
- **ORM adapters**: ship the schema *in the host's DSL* — `@postel/drizzle/schema` exports a Drizzle schema fragment the host imports and merges; `@postel/prisma` ships a `.prisma` snippet the host adds to their `schema.prisma`. A `postel schema generate <adapter>` CLI surfaces the fragment in the right format. Better Auth's `auth generate` is the precedent.

### Helpers for adapter authors

A `@postel/storage-helpers` package (zero DB deps) exports utilities every adapter would otherwise reimplement: timestamp normalization, retry-policy JSON serialization, idempotency-key formatting, message-row encode/decode, capability declarations. This is the equivalent of Better Auth's `transformInput`/`transformOutput`/`getFieldName`/`getModelName` helpers.

## Phasing for 1.0

**Tier 1 (must ship for 1.0):**
- `@postel/standalone-pg` — zero-config "drop it in" for Postgres.
- `@postel/standalone-sqlite` — same for SQLite.
- `@postel/drizzle` — ORM adapter for Drizzle.
- `@postel/prisma` — ORM adapter for Prisma.
- `@postel/kysely` — query-builder adapter for Kysely.

These cover ≥90% of the TypeScript ecosystem.

**Tier 2 (post-1.0, demand-driven):**
- `@postel/pg`, `@postel/postgres-js`, `@postel/better-sqlite3` (raw client adapters).
- MySQL / MariaDB support via whichever adapter category gains traction first.

**Polyglot cross-port:** each future language port introduces its own equivalents — `@postel/go-pgx`, `@postel/go-gorm`, `@postel/py-sqlalchemy`, etc. Same matrix, same `Storage` interface contract, gated on the compliance suite. The pattern carries across languages.

## What "first-class" means

Two databases — **Postgres ≥ 14** and **SQLite ≥ 3.40** — are the first-class **databases**. We own correctness for them end-to-end across all Tier 1 adapters and publish benchmarks against them. Other relational stores (PlanetScale, CockroachDB, libSQL, Turso, MySQL, …) connect via:

- One of the existing client/ORM adapters if the store is wire-compatible (e.g., libSQL via the Drizzle adapter), or
- A community-maintained adapter implementing the same `Storage` interface — same contract, same compliance gate.

The DDL in `specs/db-schema/0001_init.sql` is Postgres dialect with SQLite variants commented inline. Adapters for non-PG/non-SQLite stores translate where dialects diverge.

## Why operation-shaped (not CRUD)

Postel's hot path needs primitives a pure-CRUD interface can't express cleanly:

- **`FOR UPDATE SKIP LOCKED` reservation with lease**: not an UPDATE; it's UPDATE-with-row-lock-and-lease-and-return.
- **Atomic insert-or-return-existing** for idempotency keys.
- **Streaming range queries** for replays (millions of rows, can't materialize into a `findMany` array).
- **`LISTEN`/`NOTIFY` for low-latency dispatch** (no CRUD equivalent).

Better Auth uses CRUD because auth flows are stateless request/response. We can't.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Postel owns a separate connection / pool** | Defeats outbox semantics. The host can't compose their transaction with our writes. This was the original L1 framing in the predecessor ADRs; rejected once we understood the host-tx win. |
| **One internal SQL tool (Kysely) wraps everything** | Forces hosts to install Kysely even if they're on Drizzle/Prisma. Wrong fit for the OSS-library use case. |
| **CRUD-style adapter contract (Better Auth-shaped exactly)** | Hot-path primitives don't fit CRUD without lying about semantics (reservation isn't UPDATE; streaming range queries aren't `findMany`). |
| **Expose Kysely as the BYO contract** | Couples third-party adapters to Postel's internal SQL choice. Ties our hands when we want to swap, and bloats the import surface for ORM-using hosts. |
| **Full SQL string interface** | Forces every adapter target to be SQL-native (rules out future K/V-backed dedup helpers, in-memory test adapters); also unsafe. |
| **Prisma-only ORM adapter** | Too narrow. Drizzle and Kysely have non-trivial adoption; can't pick favorites. |

## Consequences

- **Capability spec `storage-layer`** needs an "Adapter matrix" requirement and a clarification that the BYO `Storage` interface is what every adapter implements (first-party included).
- **Capability spec `distribution-packaging-typescript`** package list expands to cover the Tier 1 adapters.
- **No top-level `package.json`** still holds; each adapter is a sub-package inside `typescript/packages/`.
- **Schema generators per adapter** are an implementation responsibility — Drizzle exports, Prisma fragments, raw SQL, all from one source of truth (`specs/db-schema/`).
- **The compliance test suite (`@postel/compliance`)** is the contract every adapter passes. Adapter-specific integration tests cover their own quirks; compliance covers behavioral parity.
- **Migrations runner pattern**: hand-rolled over `specs/db-schema/*.sql` for standalone/client adapters; ORM adapters use the ORM's native migration tooling against schemas we ship as fragments.

## Open questions

- **`@postel/storage-helpers` exact surface** — defined as each adapter lands.
- **Standalone adapter SQL writer** — for `@postel/standalone-pg` / `@postel/standalone-sqlite`, what writes the queries internally? Most likely Kysely; finalize during the standalone-pg spike.
- **Idempotency dedup adapters** — `dedup` is one method on `Storage`; backing stores (Postgres, SQLite, Redis, in-memory) for the receiver-side dedup helper still need their own thin adapters or a separate `DedupStore` sub-interface so `@postel/edge` can pull just that without the full storage.
- **Cross-port adapter equivalents** — when the Go port lands, what's the equivalent of "ORM adapter"? GORM / sqlc / ent. Each port picks its own Tier 1.

## How this ADR was reached

The original three drafts (PG+SQLite first-class / Kysely as L1 / operation-shaped L2) were correct individually but described an architecture where Postel owns its own DB connection. A direct comparison to Better Auth's production-tested adapter matrix surfaced the wrong assumption: **the host should hand us their DB client**, not the other way around. That single change collapses three sub-decisions into one coherent strategy, makes outbox-pattern transactions trivial for any stack, and aligns with where the TS ecosystem already lives (Drizzle / Prisma / Kysely).
