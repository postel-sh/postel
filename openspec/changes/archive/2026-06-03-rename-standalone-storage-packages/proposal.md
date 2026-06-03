## Why

The standalone storage adapters were named `@postel/standalone-pg` and `@postel/standalone-sqlite`. The shorter `@postel/pg` / `@postel/sqlite` are better DX for the drop-in path most adopters reach for first — but those names were reserved for the Tier-2 raw-client adapters. This change gives the prime names to the standalone adapters and shifts the raw-client node-postgres adapter to `@postel/node-postgres`, keeping the three-category model intact and freeing the collision. Done now, before the full SQL adapters land, so no published name churns later.

## What Changes

- **`@postel/standalone-pg` → `@postel/pg`** and **`@postel/standalone-sqlite` → `@postel/sqlite`** (package directories, `package.json` name + repository directory, READMEs).
- **Tier-2 raw-client node-postgres adapter renamed `@postel/pg` → `@postel/node-postgres`** in the spec + ADR (post-1.0, no code yet). `@postel/postgres-js` and `@postel/better-sqlite3` are unchanged.
- The three-category model (standalone / client / ORM) is retained.
- ADR 0007 amended (dated note) with the rename and the now-resolved internal-SQL-writer question (hand-written per adapter); incidental name references in ADRs 0013 / 0014 corrected; docs and repo guides updated.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`distribution-packaging-typescript`** — MODIFY *Package map*: standalone adapters renamed to `@postel/pg` / `@postel/sqlite`; Tier-2 raw-client node-postgres renamed `@postel/node-postgres`.
- **`storage-layer`** — MODIFY *Postgres support across the adapter matrix*, *SQLite support across the adapter matrix*, *Adapter matrix with three categories*, *Optional storage capabilities*: the same renames in prose, scenarios, and the `postelStandalonePg` → `postelPg` factory example.

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: unchanged.

## Impact

- `typescript/packages/storage/{standalone-pg → pg, standalone-sqlite → sqlite}/` — directory rename + `package.json` (`name`, repository `directory`) + README title.
- `decisions/0007-storage-strategy.md` (dated amendment), `decisions/0013-*`, `decisions/0014-*` — package-name references.
- Docs: `docs/content/docs/reference/packages.mdx`, `inbound/deduplication.mdx`, `inbound/index.mdx`; repo guides `CONTRIBUTING.md`, `typescript/AGENTS.md`; `@postel/core` README.
- `typescript/pnpm-lock.yaml` — regenerated for the renamed workspace packages.
- No TypeScript source imports the old specifiers, so no source imports change. The existing dedup adapter exports (`pgDedupAdapter`, `sqliteDedupAdapter`) keep their names.
