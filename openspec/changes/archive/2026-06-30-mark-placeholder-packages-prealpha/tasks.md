## 1. Author the spec deltas

- [ ] 1.1 Write `proposal.md`.
- [ ] 1.2 `specs/distribution-packaging-typescript/spec.md` — ADD `Empty placeholder packages are pre-alpha and unpublished`; MODIFY `Package map`.
- [ ] 1.3 `specs/api-surface-typescript/spec.md` — MODIFY `Effect-TS layer` (pre-alpha note).

## 2. Implementation

- [ ] 2.1 Confirm `@postel/effect` / `@postel/test` / `@postel/nextjs` / `@postel/bun` are `private: true` (already so — no change expected).

## 3. Tests

- [ ] 3.1 `distribution-packaging.test.ts` — guard: every package whose only export is `__postelPackage` is `private`; the detected placeholder set is exactly the four.

## 4. Docs (rule 8)

- [ ] 4.1 `docs/content/docs/reference/packages.mdx` — add `@postel/effect`; align pre-alpha framing.

## 5. Validation and archive

- [ ] 5.1 `openspec validate mark-placeholder-packages-prealpha --strict` green.
- [ ] 5.2 `openspec archive mark-placeholder-packages-prealpha -y`.
- [ ] 5.3 `mise run check:all` green.
- [ ] 5.4 `pnpm -C typescript ...` test / lint / typecheck / build green.
