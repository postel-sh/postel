## Why

The full SQL storage adapters shipped with `postelXxx` factory names (`postelPg`, `postelSqlite`, `postelKysely`, `postelDrizzle`, `postelPrisma`) and `xxxDedupAdapter` receiver-side factories (`pgDedupAdapter`, `sqliteDedupAdapter`). But core's reference adapters already establish a PascalCase-noun convention: `InMemoryStorage` / `InMemoryStorageOptions` for the outbound store and `InMemoryDedup` / `InMemoryDedupOptions` for receiver-side dedup. The `postelXxx` / `xxxDedupAdapter` names were the odd ones out. This change aligns every storage adapter on the same convention so the public surface reads uniformly — `SqliteStorage`, `PgStorage`, …, alongside `InMemoryStorage`; `PgDedup`, `SqliteDedup` alongside `InMemoryDedup`. Done before any storage package is published, so no released name churns.

## What Changes

- Storage factories renamed to the `XxxStorage` convention: `postelPg` → `PgStorage`, `postelSqlite` → `SqliteStorage`, `postelKysely` → `KyselyStorage`, `postelDrizzle` → `DrizzleStorage`, `postelPrisma` → `PrismaStorage`. Their options types follow: `PostelXxxOptions` → `XxxStorageOptions`.
- Receiver-side dedup factories renamed to the `XxxDedup` convention (matching `InMemoryDedup`): `pgDedupAdapter` → `PgDedup`, `sqliteDedupAdapter` → `SqliteDedup`; options `XxxDedupAdapterOptions` → `XxxDedupOptions`.
- No behavior, wire-format, DB-schema, or package-name (import specifier) change — TypeScript identifiers only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`api-surface-typescript`** — MODIFY *Postel factory returns the library instance* and *Conditional optionality of outbound and inbound*: the `Postel({ outbound: { storage: postelDrizzle(db) } })` examples become `DrizzleStorage(db)`.
- **`storage-layer`** — MODIFY *Adapter matrix with three categories*: the `postelPg(...)` / `postelDrizzle(db)` factory examples become `PgStorage(...)` / `DrizzleStorage(db)`.

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: unchanged.

## Impact

- `typescript/packages/storage/{pg,sqlite,kysely,drizzle,prisma}/src` + `test` — factory + options + dedup identifiers renamed; package public exports (`src/index.ts`) updated. No import-specifier (package-name) changes.
- Docs: `docs/content/docs/storage/*.mdx`, `inbound/deduplication.mdx`, `reference/packages.mdx`.
- `decisions/0007-storage-strategy.md`, `typescript/AGENTS.md`, `@postel/core` README — factory example snippets.
- No cross-port contract change — factory identifiers are TypeScript-port-specific; the operation-shaped `Storage` interface and the `DedupAdapter` interface are unchanged.
