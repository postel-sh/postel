## Why

Postel's marketing and docs already say it runs on "Postgres, **MySQL**, SQLite, …" and that the Drizzle / Kysely / Prisma adapters "reach MySQL" — but in code those adapters are dialect-locked to `"postgres" | "sqlite"`, and there is no native MySQL adapter. MySQL is still listed as Tier-2 / demand-driven in [ADR 0007](../../../decisions/0007-storage-strategy.md). This change makes MySQL a real, first-party backend and closes the gap between the claim and the code.

It also widens the ORM matrix: TypeORM and MikroORM are two of the most-used TypeScript ORMs and both support Postgres + MySQL + SQLite, so adding them alongside the new native MySQL work gives adopters first-party coverage of the stacks they already run.

## What Changes

- **New standalone adapter `@postel/mysql`** — Postel owns a `mysql2` pool; full outbound `Storage` + a `MysqlDedup` for inbound dedup. Mirrors `@postel/pg`.
- **MySQL dialect added to the existing ORM adapters** `@postel/drizzle`, `@postel/kysely`, `@postel/prisma` — their `dialect` union gains `"mysql"`, making the documented MySQL claim real.
- **Two new ORM adapters** `@postel/typeorm` and `@postel/mikro-orm` — each supporting Postgres + MySQL + SQLite.
- **One canonical MySQL schema** shipped from `@postel/storage-helpers` (`MYSQL_MIGRATIONS` + `MYSQL_CODEC` + `MYSQL_CAPABILITIES`) so every MySQL-targeting adapter agrees on the same tables and a host can move between them on the same database.
- **MySQL dialect translation:** `FOR UPDATE SKIP LOCKED` reservation done as select-then-update (MySQL has no `RETURNING`); `capabilities.notify = false` → polling fallback (no `LISTEN`/`NOTIFY`); `ON DUPLICATE KEY UPDATE` upserts/dedup; `<=>` null-safe equality; timestamps stored as `BIGINT` epoch-milliseconds (tz-independent); `JSON` columns; `VARCHAR` keys.
- **ADR 0007 amended** — MySQL promoted from Tier-2 to a shipped first-party adapter set (native + ORM); TypeORM / MikroORM added to the ORM category. Postgres + SQLite remain the benchmarked "first-class databases".

## Capabilities

### New Capabilities

None. This modifies the existing `storage-layer` and `distribution-packaging-typescript` capabilities.

### Modified Capabilities

- **`storage-layer`** — ADD *MySQL support across the adapter matrix*; MODIFY *Adapter matrix with three categories* (TypeORM/MikroORM in the ORM category; `@postel/mysql` standalone) and *Optional storage capabilities* (MySQL is a `notify = false` backend).
- **`distribution-packaging-typescript`** — MODIFY *Package map*: add `@postel/mysql`, `@postel/typeorm`, `@postel/mikro-orm`; extend the adapter-isolation scenario.

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: the canonical schema is unchanged — MySQL is a **dialect translation** of the existing tables/columns (same names, same versions 1–4), shipped as `MYSQL_MIGRATIONS` in `@postel/storage-helpers` exactly as the SQLite dialect already is. No new `specs/db-schema/` file.

## Impact

- New packages: `typescript/packages/storage/{mysql,typeorm,mikro-orm}/`.
- Modified packages: `@postel/storage-helpers` (MySQL exports), `@postel/drizzle` / `@postel/kysely` / `@postel/prisma` (mysql dialect), `@postel/storage-testkit` (MySQL testcontainers factory).
- `decisions/0007-storage-strategy.md` — dated amendment.
- Docs (rule 8): new `docs/content/docs/storage/{mysql,typeorm,mikro-orm}.mdx`; updated `storage/{index,meta.json,drizzle,kysely,prisma}`, `reference/packages.mdx`, `get-started/is-postel-for-me.mdx`, landing snippets if they enumerate adapters.
- `typescript/pnpm-lock.yaml` — regenerated for the new packages + peer/dev deps (`mysql2`, `typeorm`, `@mikro-orm/*`, `@testcontainers/mysql`).
- VISION.md — verified unchanged (MySQL already in scope; no identity / persona / §7 shift).
