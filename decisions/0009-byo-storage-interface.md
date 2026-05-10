# 0009 — L2 BYO `Storage` interface design

- **Status**: **Proposed** (decision pending; should land alongside or shortly after [ADR 0008](0008-storage-abstraction.md). Blocks any community port that needs a non-PG/non-SQLite backend, and gates the shape of `@postel/postgres`, `@postel/sqlite` themselves since they are the first implementers of this interface.)
- **Date**: 2026-05-10
- **Scope**: **L2 only** — the technology-agnostic, method-based `Storage` interface that BYO adapter authors implement. Distinct from L1 (the SQL tool used inside our first-party adapters; see [ADR 0008](0008-storage-abstraction.md)).
- **Decision drivers**: outbox semantics survive the abstraction, BYO portability across libSQL/Turso/D1/PlanetScale/Cockroach/Hyperdrive, transaction model, optional capabilities

> **For the next agent picking this up**: this ADR fixes the public contract third parties implement. Once accepted, our own `@postel/postgres` and `@postel/sqlite` are just the first two implementations of it. Get this wrong and every BYO adapter has to fight the contract; get it right and `D1`/`libSQL`/`Turso` adapters become 200-line files.

## Two layers, recap

[ADR 0008](0008-storage-abstraction.md) explains the L1 / L2 split. Short version:

- **L1** (ADR 0008): the SQL tool inside `@postel/postgres` and `@postel/sqlite`. Likely Kysely. Internal detail.
- **L2** (this ADR): the method-based contract every storage adapter — first-party AND third-party — exposes upward to the rest of Postel.

The first-party adapters wrap their L1 tool to produce an L2 implementation. A BYO author skips L1 entirely and implements L2 against whatever underlying client they want.

## Context

Postel's storage needs span a richer surface than typical CRUD:

- **Worker reservation under row-level lock with lease expiry** (Postgres `FOR UPDATE SKIP LOCKED`; SQLite `BEGIN IMMEDIATE` + atomic UPDATE; D1/libSQL: simulate via UPDATE-WHERE on a reservation column).
- **Transactional outbox** (insert in the host's transaction, not a separate connection).
- **Late-binding fanout** (read endpoint config + secrets at dispatch time per attempt).
- **Idempotency dedup** (atomic insert-or-return).
- **Replay range/predicate queries** (potentially large; need streaming).
- **Optional pub/sub** (`LISTEN`/`NOTIFY` on Postgres; polling fallback elsewhere).

A pure CRUD interface (`create / findOne / findMany / update / delete / count`) cannot express these cleanly — `SKIP LOCKED` reservation isn't an UPDATE, it's UPDATE-with-lock-and-lease-and-return-row, atomic, with worker fairness semantics. Better Auth's adapter contract uses CRUD because auth flows are stateless request/response; that doesn't carry over.

## Lessons from Better Auth (cited because the dual-layer pattern is the same)

Better Auth implements a dual L1/L2 split similar to ours: Kysely under the hood for first-party adapters ([ref](https://better-auth.com/docs/adapters/postgresql)), method-based custom adapter contract for everything else ([ref](https://better-auth.com/docs/guides/create-a-db-adapter)). What's transferable:

| Pattern | We adopt? |
|---|---|
| Method-shaped L2 contract (not query-builder-shaped) | ✅ yes — keeps L1 internal |
| Helpers shipped to adapter authors (`transformInput/Output`, `getFieldName`, `getModelName`) so each adapter doesn't reimplement field mapping | ✅ yes — Postel equivalents: `serializeRetryPolicy`, `formatIdempotencyKey`, `pgRowToMessage`, `messageToRow`, etc. |
| Transaction as callable: `transaction: false \| (cb: (tx) => Promise<R>) => Promise<R>` | ✅ yes — same shape |
| Optional capabilities with graceful degradation (Better Auth's transactions can be opted out) | ✅ yes — apply to `notify` / `subscribe` (PG-only); Postel polls when absent |
| User owns connection + schema | ✅ yes — adapter consumes both |
| CRUD method names (`create`, `findOne`, etc.) | ❌ **no** — wrong shape for our hot path; we go operation-shaped |

## Working sketch of the interface (subject to refinement during implementation)

```ts
interface Storage {
  // ── Outbox (transactional with host) ──────────────────────────────────────
  insertMessage(
    msg: NewMessage,
    opts?: { tx?: HostTransaction },
  ): Promise<MessageId>;

  // Returns existing MessageId if (tenantId, idempotencyKey) is already taken;
  // otherwise inserts and returns the new id. MUST be atomic.
  insertOrReuseByIdempotencyKey(
    msg: NewMessage,
    opts?: { tx?: HostTransaction },
  ): Promise<{ id: MessageId; reused: boolean }>;

  // ── Worker reservation (the SKIP-LOCKED equivalent) ───────────────────────
  reserveBatch(opts: {
    workerId: string;
    leaseMs: number;
    batchSize: number;
    tenantFilter?: TenantId;       // for fairness scheduling
  }): Promise<ReservedMessage[]>;

  recordAttempt(attempt: NewAttempt): Promise<void>;
  releaseLease(messageId: MessageId): Promise<void>;
  expireStaleLeases(now: Date): Promise<number>;  // for crash recovery

  // ── Late-binding fanout ───────────────────────────────────────────────────
  loadEndpointsForMessage(messageId: MessageId): Promise<EndpointWithSecrets[]>;

  // ── Endpoint CRUD + state machine ─────────────────────────────────────────
  endpoints: {
    create(e: NewEndpoint, opts?: { tx?: HostTransaction }): Promise<Endpoint>;
    update(id: EndpointId, patch: Partial<Endpoint>, opts?: { tx?: HostTransaction }): Promise<Endpoint>;
    transitionState(id: EndpointId, transition: StateTransition): Promise<void>;
    list(filter: EndpointFilter, page: Pagination): Promise<Page<Endpoint>>;
    get(id: EndpointId): Promise<Endpoint | null>;
  };

  secrets: {
    rotate(endpointId: EndpointId, params: RotateParams): Promise<void>;
    listForEndpoint(endpointId: EndpointId): Promise<EndpointSecret[]>;
  };

  // ── Replay / reconciliation (cold path, may be large) ─────────────────────
  rangeQuery(filter: MessageFilter): AsyncIterable<Message>;
  reconcile(filter: ReconcileFilter): AsyncIterable<UnconfirmedMessage>;

  // ── Multi-tenancy ─────────────────────────────────────────────────────────
  tenants: {
    delete(tenantId: TenantId): Promise<void>;  // cascades atomically
  };

  // ── Idempotency dedup helper (on the receiver side) ───────────────────────
  dedup(messageId: string, opts: { ttlSeconds: number }): Promise<{ duplicate: boolean }>;

  // ── Transactions ──────────────────────────────────────────────────────────
  transaction<R>(cb: (tx: HostTransaction) => Promise<R>): Promise<R>;

  // ── Optional capabilities (PG can; SQLite can't; libSQL can't) ────────────
  notify?(channel: string, payload?: string): Promise<void>;
  subscribe?(channel: string, handler: (payload: string) => void): Unsubscribe;

  // ── Metadata ──────────────────────────────────────────────────────────────
  capabilities: StorageCapabilities;     // declared at adapter init time
  schemaVersion(): Promise<number>;
}
```

The shape is illustrative — the `1-day spike` plus the storage-layer capability spec scenarios will refine it. But the operation set is what we need.

## Constraints

1. **Operation-shaped, not CRUD-shaped.** Reservation-with-lease, atomic-insert-or-reuse, range streaming are not modelable as CRUD without lying about semantics.
2. **Transaction as callable** — `transaction(cb)` is the standard shape. Adapters that don't support real transactions provide a shim that runs the callback sequentially and document the consequences.
3. **Optional capabilities declared up front** via `capabilities: StorageCapabilities`. If `capabilities.notify === false`, the worker scheduler falls back to polling at the configured interval.
4. **Helpers belong in `@postel/storage-helpers`** — a leaf package, no DB dependency, exporting the format/serialize/parse utilities every adapter would otherwise reimplement. (Better Auth's `transformInput/Output` for our domain.)
5. **Host-transaction passthrough** — every write that participates in the outbox accepts an optional `tx` argument that the host opens.
6. **Stable across minor versions** ([storage-layer spec, "BYO storage interface" requirement](../openspec/specs/storage-layer/spec.md)). Breaking changes only at majors.
7. **Implementable without knowing L1.** A community adapter author MUST NOT need to import Kysely (or whatever ADR 0008 picks) to implement `Storage`.
8. **Edge-aware**. `dedup` is the only `Storage` method `@postel/edge` calls; the receiver's edge build must be able to import a tiny `Storage` subset (or a `DedupStore`-only sub-interface) without dragging the whole contract into the bundle. Likely: split `DedupStore` out as its own interface, with `Storage extends DedupStore`.

## Open questions

- **Should `Storage` extend `DedupStore` or be separate?** Edge bundle size pushes toward "separate, with `DedupStore` being the only thing `@postel/edge` knows."
- **Is `AsyncIterable` the right shape for `rangeQuery`?** Replays can run into millions of rows; we don't want to materialize into an array. AsyncIterable + back-pressure is the textbook answer; verify all candidate L1 tools and likely BYO targets can produce it without buffering everything.
- **Does `transitionState` belong on `Storage` or as a higher-level method that calls into `Storage`?** It needs to write both the endpoint state and the audit row atomically; could go either way. Cleaner if `Storage.transaction(...)` lets the higher level compose them.
- **Capabilities flag enum** — do we model these as discrete booleans or a versioned capability set? Booleans now; revisit if it grows past ~6 fields.
- **Tenant cascade** — delete-cascade in the schema does the work for first-party adapters, but BYO targets without FK cascades will need to implement it manually. Document the requirement; provide a default loop in the helpers package.

## How to close this ADR

1. Read this doc cold.
2. **Day 1 of the storage spike**: implement the worker-reservation path against the sketch interface using L1 (per ADR 0008). Refine the sketch as the implementation reveals friction.
3. Once the `@postel/postgres` adapter compiles cleanly against the interface and passes a worker-reservation correctness test, declare the L2 contract stable enough to publish.
4. Update Status from "Proposed" to "Accepted", paste in the final interface as the Decision section, and remove the "For the next agent" preamble.
5. Add concrete API-surface requirements to the [storage-layer capability spec](../openspec/specs/storage-layer/spec.md) via an OpenSpec change (the methods become testable scenarios).

## Alternatives considered

- **CRUD interface (Better Auth-style)** — rejected. Worker reservation can't be expressed as UPDATE without losing semantics; range streaming via `findMany` requires materialization.
- **Expose Kysely as the BYO contract** — rejected. Couples third-party adapters to our L1 tool. Worse: ties our hands when we want to swap L1 later. Violates [ADR 0008](0008-storage-abstraction.md) constraint #6.
- **Full SQL string interface** — rejected. Forces every BYO target to be SQL-native (rules out future K/V-backed dedup, in-memory test adapters); also unsafe.
- **One enormous interface for everything** vs **several small interfaces composed** — leaning toward the latter (`OutboxStore`, `EndpointStore`, `DedupStore`, `AuditStore`, etc.) so edge runtimes can import only what they need. Tracked as an open question above.
