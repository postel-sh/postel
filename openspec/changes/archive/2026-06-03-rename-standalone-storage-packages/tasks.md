## 1. Package rename (mechanical)

- [x] 1.1 `git mv` `typescript/packages/storage/standalone-pg` → `pg`, `standalone-sqlite` → `sqlite`.
- [x] 1.2 Update each `package.json` `name` (`@postel/pg`, `@postel/sqlite`) + repository `directory`; update README titles.
- [x] 1.3 `pnpm install` to regenerate `pnpm-lock.yaml` for the renamed workspace packages.

## 2. Spec + ADR

- [x] 2.1 `distribution-packaging-typescript` MODIFY *Package map* (standalone → `@postel/pg`/`@postel/sqlite`; Tier-2 client `@postel/pg` → `@postel/node-postgres`).
- [x] 2.2 `storage-layer` MODIFY *Postgres support*, *SQLite support*, *Adapter matrix with three categories*, *Optional storage capabilities*.
- [x] 2.3 ADR 0007 dated amendment (rename + resolved SQL-writer question); fix name references in ADRs 0013 / 0014.

## 3. Docs (rule 8) + guides

- [x] 3.1 `docs/content/docs/reference/packages.mdx`, `inbound/deduplication.mdx`, `inbound/index.mdx`.
- [x] 3.2 `CONTRIBUTING.md`, `typescript/AGENTS.md`, `@postel/core` README.

## 4. Verify + archive

- [x] 4.1 `openspec validate rename-standalone-storage-packages --strict`.
- [x] 4.2 `pnpm --filter @postel/pg test typecheck build` + `@postel/sqlite` (renamed packages still green).
- [x] 4.3 `mise run check:all` + `mise run docs:typecheck`.
- [x] 4.4 `openspec archive rename-standalone-storage-packages -y`.
