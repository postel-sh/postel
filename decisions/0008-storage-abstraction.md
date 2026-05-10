# 0008 — Storage abstraction layer

- **Status**: **Proposed** (decision pending; must be made before any meaningful TS code lands — this is the single largest blocker for implementation)
- **Date**: 2026-05-10
- **Decision drivers**: outbox-pattern correctness, Postgres ↔ SQLite parity, BYO adapter ergonomics, host-transaction interop, no leak of storage code into the edge bundle

> **For the next agent picking this up**: this ADR captures everything we know about what storage needs to do in Postel. Read it cold, decide, then move the Status to "Accepted" and fill in the Decision section. The Context and Constraints sections should be enough to pick a candidate without rebuilding the picture from scratch.

## Context

Postel is a polyglot webhooks library backed by solid, executable specs. The TypeScript implementation in this repo ships first. The storage layer is one of the larger architectural pieces, and the abstraction over Postgres + SQLite (plus BYO) shapes every capability that touches persistence — which is most of them.

Two distinct concerns ride on top of the storage layer:

1. **Transactional outbox (hot path)** — every `send()` inserts a row into `messages` *inside the host's transaction*. Workers reserve pending rows under `FOR UPDATE SKIP LOCKED` (Postgres) or `BEGIN IMMEDIATE` (SQLite), dispatch them, record `attempts`, retry on schedule. This is the load-bearing part: throughput target is ≥ 10,000 deliveries/sec on a single Postgres node ([sender spec](../openspec/specs/sender/spec.md)).

2. **Audit trail / admin reads (cold path)** — replay queries by time range and predicate, reconciliation queries for never-confirmed deliveries, paginated admin reads with tenant filtering, retention pruning.

Canonical schema lives at [`specs/db-schema/0001_init.sql`](../specs/db-schema/0001_init.sql) (Postgres dialect, SQLite variants commented inline).

## What the storage layer must support

### Persisted objects

| Table | Role |
|---|---|
| `_postel_meta` | Schema version handshake |
| `tenants` | Multi-tenant scope (NULL allowed for single-tenant) |
| `endpoints` | Endpoint config: URL, types, channels, retry policy, signing, state, metadata |
| `endpoint_secrets` | Priority-ordered, encrypted secret arrays per endpoint (rotation overlap windows live here) |
| `messages` | The outbox — one row per `send()` |
| `attempts` | Per-endpoint, per-message delivery attempts (response code, latency, error, replay_of) |
| `endpoint_state_transitions` | Audit log for endpoint state changes |

### Hot-path operations (constrain the abstraction choice)

| Operation | What it needs from SQL |
|---|---|
| `send()` enqueue | INSERT into `messages` **inside the host's transaction** — no separate connection, no fire-and-forget. Outbox semantics depend on this. |
| Worker reservation | Reserve N pending rows under `FOR UPDATE SKIP LOCKED` (Postgres) / `BEGIN IMMEDIATE` (SQLite), with a lease expiration so crashed workers don't strand messages |
| Low-latency dispatch | Postgres `LISTEN` / `NOTIFY`; SQLite polls — needs raw connection access |
| Idempotency dedup | Unique partial index on `(tenant_id, idempotency_key)`; `INSERT … ON CONFLICT DO NOTHING RETURNING` (or equivalent) |
| Late-binding fanout | Read endpoint config + secrets at dispatch time, not send time — every retry re-reads |
| Retry scheduling | UPDATE `attempts.scheduled_for` based on policy + jitter + `Retry-After` |

### Cold-path operations

| Operation | What it needs from SQL |
|---|---|
| Replay (range) | Range scans on `messages` by `(tenant_id, endpoint_id, created_at, type)`; tag re-enqueued attempts with `replay_of` |
| Replay (predicate) | Arbitrary WHERE clause / TS predicate over messages — need a way to safely express user-supplied filters |
| Reconciliation | "Messages whose latest attempt isn't `success`" — a join on `messages` × latest `attempts` |
| Admin handlers | Paginated reads with filters; the auth predicate restricts visibility |
| Retention / pruning | Background DELETE of old `attempts` (and the `dead_letter` view over them) |
| Tenant deletion | Cascade across endpoints, secrets, messages, attempts in a single transaction |

## Constraints (the things that decide it)

1. **`FOR UPDATE SKIP LOCKED` is non-negotiable.** Worker reservation correctness depends on it. Whatever abstraction we pick must expose it cleanly, not as a raw-SQL escape hatch.
2. **`LISTEN` / `NOTIFY` plumbing on Postgres** needs raw connection access. The abstraction must not block this.
3. **Postgres ↔ SQLite parity** in dialect surface: JSONB vs JSON1, `now()` vs `datetime('now')`, `RETURNING` (Postgres ≥ 14, SQLite ≥ 3.40 both have it).
4. **Edge-runtime constraint**: `@postel/edge` (≤ 50 KB minified+gzipped) needs the **dedup helper only** — nothing else from the storage layer should leak in. Tree-shaking has to be aggressive. The dedup helper itself can use a minimal sub-adapter.
5. **Host transactions**: every write API (`send`, `endpoints.create`, `endpoints.update`, `tenants.delete`) accepts an optional `db` (transaction handle). Whatever abstraction we pick must let the host pass its own transaction in.
6. **BYO storage interface** (per [storage-layer spec](../openspec/specs/storage-layer/spec.md)): someone running PlanetScale / CockroachDB / Turso / libSQL must be able to implement the interface without forking the library. The abstraction's interface is what they implement against.
7. **Type safety** end-to-end. Capability specs say no `any` in the public surface. Untyped query builders are out.
8. **Migrations runner** must work programmatically (`postel.migrate(db)` per [storage-layer spec](../openspec/specs/storage-layer/spec.md)), idempotently, and be safe to invoke on every boot.

## Candidate approaches

### A. Kysely (typed query builder, "just SQL")

- **Pros**: Native `forUpdate().skipLocked()` support; type-safe schema → query → result; supports Postgres + SQLite + arbitrary drivers; "no magic, just SQL" philosophy fits Postel; reasonable bundle weight; transactions are first-class; no codegen step required (types come from a hand-written schema interface).
- **Cons**: Smaller ecosystem than Drizzle; the BYO adapter has to wrap Kysely's `Driver` interface (some boilerplate); migrations are hand-rolled (Kysely ships a migration runner, but it's basic).
- **Edge story**: Kysely itself is small enough to use in `@postel/edge` for the dedup helper if needed; the full schema definitions don't have to be imported there.

### B. Drizzle ORM (schema-as-TS, codegen optional)

- **Pros**: Fast-growing TS ecosystem; good edge runtime story; type-safe; supports Postgres + SQLite; nice migration tooling.
- **Cons**: `SKIP LOCKED` requires `sql\`...\`` raw fragments — possible but un-ergonomic for a hot path; schema-as-code is the integration point, which couples BYO adapters tighter than Kysely; opinionated about how the schema is shaped (tagged template builders for tables); pulls more weight than the "low-level outbox" needs.
- **Edge story**: actively edge-friendly; this is one of Drizzle's pitches.

### C. Raw SQL templates (e.g., `postgres` from porsager, or `pg-promise`, or hand-rolled tagged templates)

- **Pros**: Zero abstraction tax; full control over `SKIP LOCKED`, `LISTEN`/`NOTIFY`, JSONB; smallest possible bundle; trivially supports any SQL primitive Postgres or SQLite ships.
- **Cons**: No type safety on query results without manual generic annotations or a separate codegen step; dialect parity is hand-rolled per query (or via a thin wrapper); BYO adapter needs both adapter + query parity story.
- **Edge story**: tiny — this would minimize bundle pressure.

### D. Prisma

- **Pros**: Nice DX for app code; widely known.
- **Cons**: Heavy (Rust binary historically; engine size is a problem for libraries); `SKIP LOCKED` is awkward (`$queryRaw` escape); schema-as-DSL; codegen step is a deployment concern; not the right shape for low-level outbox semantics; edge story has improved but is still extra weight; couples consumers to Prisma's schema model. **Not recommended for a library.**

### E. Knex / `pg` + `sqlite3` directly (no abstraction)

- **Pros**: Minimal, well-known.
- **Cons**: Knex's types are weak; `pg` + `sqlite3` means writing two separate code paths for every operation — defeats the purpose of an abstraction. **Not recommended unless A/B/C all fail evaluation.**

## Evaluation against constraints

| Constraint | Kysely | Drizzle | Raw SQL | Prisma |
|---|---|---|---|---|
| `FOR UPDATE SKIP LOCKED` ergonomic | ✅ native | ⚠️ raw fragment | ✅ trivial | ⚠️ `$queryRaw` |
| `LISTEN`/`NOTIFY` access | ✅ via driver | ✅ via driver | ✅ direct | ⚠️ awkward |
| Postgres ↔ SQLite parity | ✅ same builder | ✅ same builder | ⚠️ per-query | ⚠️ different schemas |
| Edge bundle (dedup helper only) | ✅ small | ✅ small | ✅ smallest | ❌ heavy |
| Host transaction passthrough | ✅ first-class | ✅ first-class | ✅ via driver | ⚠️ awkward |
| BYO adapter ease | ✅ wrap `Driver` | ⚠️ schema coupling | ✅ trivial | ❌ coupled |
| Type safety end-to-end | ✅ inferred | ✅ inferred | ⚠️ manual | ✅ codegen |
| No codegen step | ✅ | ⚠️ optional | ✅ | ❌ required |
| Library-shape (not app-shape) | ✅ | ⚠️ | ✅ | ❌ |

## Working recommendation (subject to override)

**Kysely** is the leading candidate. It's the best fit on the hot-path constraints (native `SKIP LOCKED`, type safety without codegen, clean transaction passthrough, BYO via a small `Driver` wrapper) and doesn't carry the weight of an ORM the library doesn't need.

**Raw SQL templates** are the strong runner-up if Kysely's surface ends up too constraining once we start writing real queries. The fallback path from Kysely → raw templates is mechanical (Kysely's compiled SQL is essentially what we'd hand-write).

**Drizzle** is third. Its ecosystem advantage is real but the `SKIP LOCKED` ergonomics are wrong for our hot path, and its schema-as-code is heavier coupling than the BYO interface should require.

**Prisma** is out for library-shape reasons.

## Open questions before deciding

- **Kysely on edge**: confirm the bundle weight of importing `Kysely` from `@postel/edge`'s dedup helper. If it pushes us past 50 KB, the dedup helper uses a leaner sub-adapter (likely raw SQL against a single op).
- **Migrations**: do we use Kysely's built-in migration runner, or hand-roll a runner that reads `specs/db-schema/*.sql` directly? The latter keeps the canonical SQL files as the source of truth (consistent with the spec layout); the former is more conventional. Probably hand-roll for source-of-truth alignment.
- **BYO interface contract**: do we expose `Kysely<DB>` directly to BYO implementers, or wrap it in a smaller `Storage` interface that doesn't leak Kysely as a public type? Wrapping is more polite to non-Kysely users (and keeps the option to swap Kysely later).
- **JSONB / JSON1**: confirm Kysely's JSON helpers behave consistently across dialects, or accept that JSON columns are encoded/decoded application-side.

## How to close this ADR

1. Read this doc cold.
2. Run a 1-day spike: implement the worker-reservation path (the `SKIP LOCKED` reserve + lease + dispatch loop) in Kysely against Postgres and SQLite. If it fits cleanly, accept Kysely. If it fights us, fall back to raw SQL templates.
3. Update Status from "Proposed" to "Accepted", fill in the Decision section with the chosen tool + rationale, and remove the "For the next agent" preamble.
4. The decision unlocks the storage adapter implementation; an OpenSpec change can then add concrete API-surface requirements to `storage-layer` if needed.

## Related open decisions (all blocking, not all equally)

These are flagged here so a single PR doing storage setup can also chip away at the rest. Each warrants its own ADR (or a quick "decided" note) before code lands.

| # | Decision | Reasonable default | Blast radius |
|---|---|---|---|
| 1 | **Monorepo tooling** | pnpm workspaces + Turbo | High — touches every package |
| 2 | **Build tool** | tsup (ESM+CJS dual per [distribution-packaging](../openspec/specs/distribution-packaging/spec.md)) | High |
| 3 | **Test framework** | Vitest | Medium |
| 4 | **Linter / formatter** | Biome (single-tool) or ESLint + Prettier | Low |
| 5 | **HTTP client for outbound dispatch** | Global `fetch` (edge-friendly) | Low |
| 6 | **Migrations runner pattern** | Hand-roll over `specs/db-schema/*.sql` (see open questions above) | Medium |
| 7 | **KMS adapter contract** | Envelope encryption with `encrypt(plaintext) → ciphertext`, `decrypt(ciphertext) → plaintext` and a key-wrap interface | Medium — affects key-management capability |
| 8 | **Admin handler auth integration** | Host-supplied predicate `(req, action, resource) => boolean`; library invokes per read | Medium |
| 9 | **JWKS caching strategy on edge** | Per-isolate cache + KV-backed shared cache, configurable | Low |
| 10 | **Compliance suite implementation tech** | Node CLI making real HTTP calls; vendor-neutral | Medium — gates every port |
| 11 | **Idempotency dedup adapter contracts per backing store** | Adapters for Postgres, SQLite, Redis, in-memory; same `dedup(id, { ttl })` shape | Medium |

### Pre-1.0 decisions (already flagged in [VISION.md](../VISION.md) / ADRs)

- **License** — MIT vs Apache-2.0 ([VISION.md §5](../VISION.md))
- **Community-port governance** — in-repo `packages/go` vs sibling repo `postel-sh/postel-go` (affects [ADR 0007](0007-polyglot-staged-rollout.md) edges)
- **Capability spec versioning** — does `openspec/specs/<cap>/spec.md` carry a version field so ports can declare which version they conform to?
- **Effect-TS layer ship timing** — day-1 stub or after core lands?
- **Docs site stack** — Astro Starlight / Nextra / Fumadocs / Docusaurus
- **Release tooling** — Changesets vs alternatives, given the shared-major-version requirement in [distribution-packaging](../openspec/specs/distribution-packaging/spec.md)

## Alternatives considered (and why not)

The "candidate approaches" section above is the alternatives list. The summary: Kysely fits the constraints; Drizzle fights the hot-path ergonomics; raw SQL is the fallback if Kysely's compiled output is too restrictive; Prisma is library-wrong.
