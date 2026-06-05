## MODIFIED Requirements

### Requirement: Package map

The library SHALL be distributed as the following npm packages, grouped by purpose:

**Core:**
- `@postel/core` — sender + receiver + types + errors. The receiver-side verify / dedup / JWKS-consumer surface ships here directly; there is no separate edge-runtime carve-out package. The **in-memory `Storage` adapter** (`InMemoryStorage`) and the **in-memory dedup adapter** (`inMemoryDedupAdapter`) also ship from `@postel/core` — they are the reference implementations, the deterministic test backend, and the zero-config default. Both are leaf exports: a receiver-only bundle that imports `verify` does not pull them in (see `Tree-shakeability`).

**Storage adapters (Tier 1 — must ship for 1.0, per [ADR 0007](../../../decisions/0007-storage-strategy.md)):**
- `@postel/pg` — Postel owns the Postgres pool; zero-config drop-in.
- `@postel/sqlite` — same for SQLite.
- `@postel/mysql` — Postel owns the MySQL (`mysql2`) pool; zero-config drop-in. Also exports `MysqlDedup` for inbound dedup.
- `@postel/drizzle` — host hands Postel a Drizzle instance (any dialect Drizzle supports — Postgres, MySQL, SQLite, …).
- `@postel/prisma` — host hands Postel a `PrismaClient` (Postgres, MySQL, or SQLite dialect).
- `@postel/kysely` — host hands Postel a `Kysely<DB>` (Postgres, MySQL, or SQLite dialect).
- `@postel/typeorm` — host hands Postel a TypeORM `DataSource` (Postgres, MySQL, or SQLite dialect).
- `@postel/mikro-orm` — host hands Postel a MikroORM `EntityManager` (Postgres, MySQL, or SQLite dialect).
- `@postel/storage-helpers` — zero-DB-dependency helpers package every adapter (first-party or third-party) imports for timestamp normalization, retry-policy JSON serialization, idempotency-key formatting, capability flags, and message/attempt row encode/decode.

(Tier 2 raw-client adapters — `@postel/node-postgres`, `@postel/postgres-js`, `@postel/better-sqlite3` — are explicitly post-1.0 demand-driven additions per ADR 0007, not in this Tier-1 package map.)

**Framework-core:**
- `@postel/http` — the framework-agnostic webhook HTTP layer every framework adapter binds to: a normalized `handleInbound` outcome function, a Web-Fetch `fetchWebhook` request-handler builder, a `@postel/http/node` entry for Node `req`/`res` frameworks, and the single canonical `PostelError`→HTTP-status policy. Depends only on `@postel/core`; pulls in no framework.

**Framework adapters:**
- `@postel/express`, `@postel/hono`, `@postel/fastify`, `@postel/nestjs`, `@postel/nextjs`, `@postel/bun` — receiver middleware / guards + admin handlers. Each depends on `@postel/http` for the verification gate and error→status policy rather than re-deriving them.

**Auxiliary:**
- `@postel/admin` — framework-agnostic admin HTTP handler builder.
- `@postel/effect` — Effect-TS layer over the core API.
- `@postel/test` — test fixtures + signature generators + mock receivers for adopter unit tests.
- `@postel/compliance-driver` — HTTP control-plane shim the `@postel/compliance` suite drives in `--sender-control` mode. Distinct from `@postel/test` (audience: adopters) and `@postel/cli` (audience: adopters): its stability surface is a CONTRACT artifact tracked by the compliance suite's lockstep version.
- `@postel/cli` — `postel` CLI binary (migrate, sign, verify, replay, simulate).

The `@postel/compliance` suite is **not part of this list**: per the `compliance` capability spec, the suite's implementation language and distribution channel are open. If a future change implements the runner as a TypeScript npm package, it will be added here at that point; until then, the suite's source lives at top-level `compliance/` and its distribution mechanism is undecided.

Each package MUST have a single, documented purpose declared in its `package.json` `description` field (≤ 120 chars).

#### Scenario: Importing a storage adapter does not pull other adapters

- **WHEN** a host installs only `@postel/drizzle`
- **THEN** `@postel/prisma`, `@postel/kysely`, `@postel/typeorm`, `@postel/mikro-orm`, `@postel/pg`, `@postel/sqlite`, and `@postel/mysql` are NOT transitively installed

#### Scenario: storage-helpers has no DB dependency

- **WHEN** a consumer installs `@postel/storage-helpers`
- **THEN** no Postgres / SQLite / MySQL / other DB client is pulled in transitively

#### Scenario: compliance-driver is not pulled by core

- **WHEN** a consumer installs `@postel/core`
- **THEN** `@postel/compliance-driver` is NOT transitively installed
- **AND** `@postel/compliance-driver`'s control-plane surface is reachable only by explicit install

#### Scenario: framework adapters depend on the HTTP core

- **WHEN** a host installs `@postel/hono`
- **THEN** `@postel/http` is present transitively (the adapter binds the shared gate + error→status policy)
- **AND** no other framework's adapter (`@postel/express`, `@postel/fastify`, `@postel/nestjs`, …) is pulled in
