## 1. Rename (mechanical)

- [x] 1.1 Storage factories `postelXxx` → `XxxStorage` and options `PostelXxxOptions` → `XxxStorageOptions` across the five storage packages (src + tests).
- [x] 1.2 Receiver-side dedup `xxxDedupAdapter` → `XxxDedup` and options `XxxDedupAdapterOptions` → `XxxDedupOptions` (`@postel/pg`, `@postel/sqlite`).
- [x] 1.3 Update each package's public exports (`src/index.ts`).

## 2. Spec

- [x] 2.1 `api-surface-typescript` MODIFY *Postel factory returns the library instance*, *Conditional optionality of outbound and inbound*.
- [x] 2.2 `storage-layer` MODIFY *Adapter matrix with three categories*.

## 3. Docs (rule 8) + guides

- [x] 3.1 `docs/content/docs/storage/*.mdx`, `inbound/deduplication.mdx`, `reference/packages.mdx`.
- [x] 3.2 `decisions/0007-storage-strategy.md`, `typescript/AGENTS.md`, `@postel/core` README.

## 4. Verify + archive

- [x] 4.1 `openspec validate rename-storage-factory-functions --strict`.
- [x] 4.2 `pnpm typecheck` + `pnpm test` + `pnpm lint` (TS workspace green).
- [x] 4.3 `mise run check:all` + docs build.
- [x] 4.4 `openspec archive rename-storage-factory-functions -y`.
