## 1. Spec

- [x] 1.1 `receiver` MODIFY *Idempotency dedup helper* — source-scoped `postel.inbound.<source>.dedup`, no top-level `postel.dedup`.
- [x] 1.2 `distribution-packaging-typescript` MODIFY *Package map* — core's in-memory dedup export is `InMemoryDedup`.

## 2. Implementation

- [x] 2.1 Move the in-memory dedup implementation into `typescript/packages/core/src/strategies/dedup.ts`; delete `core/src/dedup.ts` (the `dedup` sugar and `inMemoryDedupAdapter` alias).
- [x] 2.2 `core/src/index.ts` exports only `InMemoryDedup` + `InMemoryDedupOptions` for in-memory dedup; `dedup` / `inMemoryDedupAdapter` removed.

## 3. Sweep internal consumers

- [x] 3.1 `typescript/packages/core/test/dedup.test.ts` — drive the scenarios through `postel.inbound.<source>.dedup` + `InMemoryDedup`.
- [x] 3.2 `typescript/packages/http/test/dedup-ack.test.ts` — `inMemoryDedupAdapter()` → `InMemoryDedup()`.
- [x] 3.3 `typescript/packages/storage/{pg,sqlite,mysql}/test/dedup.test.ts` — replace the top-level `dedup` import.
- [x] 3.4 `typescript/scripts/reference-receiver.mjs` — `InMemoryDedup` + direct `record()` call.

## 4. Docs (rule 8)

- [x] 4.1 Grep `docs/content/docs/` + `docs/app/(home)/page.tsx` for `inMemoryDedupAdapter` / top-level `dedup` imports; confirm `deduplication.mdx` teaches only `InMemoryDedup` + `postel.inbound.<source>.dedup`.

## 5. Verify + archive

- [x] 5.1 `openspec validate single-dedup-export --strict`.
- [x] 5.2 `mise run check:all` + TS workspace green (`pnpm typecheck && pnpm test && pnpm lint && pnpm build`).
- [x] 5.3 `openspec archive single-dedup-export -y`.
