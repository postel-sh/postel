## 1. Spec delta

- [ ] 1.1 Write `proposal.md`.
- [ ] 1.2 Write `specs/distribution-packaging-typescript/spec.md` delta — MODIFIED *Package map* (remove `@postel/memory`, note in-core in-memory adapter, update isolation scenario).
- [ ] 1.3 Write `language-impact.md`.

## 2. Code move

- [ ] 2.1 Relocate `packages/memory/src/{adapter,mutex,tx}.ts` → `packages/core/src/storage/memory/`, fixing imports to relative core paths.
- [ ] 2.2 Export `InMemoryStorage`, `InMemoryStorageOptions`, `InMemoryTx` from `packages/core/src/index.ts`.
- [ ] 2.3 Move `packages/memory/test/*.test.ts` → `packages/core/test/`, importing from `../src/index.js`.
- [ ] 2.4 `packages/core/tsconfig.json` includes `test/**` (noEmit) so the type-flow tests are typechecked. Drop `_storage-stub.ts`; use `InMemoryStorage` in `postel-factory.test.ts`.
- [ ] 2.5 `packages/compliance-driver` imports `InMemoryStorage` from `@postel/core`; drop the `@postel/memory` dependency.
- [ ] 2.6 Delete `packages/memory/`.
- [ ] 2.7 `pnpm install`.

## 3. Validation + archive

- [ ] 3.1 `openspec validate move-memory-adapter-into-core --strict` green.
- [ ] 3.2 `pnpm typecheck` / `test` / `lint` / `build` green; `go test ./...` and `mise run check:all` green.
- [ ] 3.3 `openspec archive move-memory-adapter-into-core -y`.
- [ ] 3.4 Re-run `openspec validate --all` green after archive.
