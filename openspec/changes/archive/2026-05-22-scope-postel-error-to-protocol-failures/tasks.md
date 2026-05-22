## 1. Author the spec delta

- [x] 1.1 Write `proposal.md`.
- [x] 1.2 Write `specs/api-surface-typescript/spec.md` delta — MODIFIED `Structured error classes`.

## 2. Implementation

- [x] 2.1 Revert `NotImplementedError` in `@postel/core/src/errors.ts` to extend `Error` directly.
- [x] 2.2 Remove `"NOT_IMPLEMENTED"` from the `PostelErrorCode` union in `@postel/edge/src/errors.ts`.
- [x] 2.3 Update the test in `@postel/core/test/postel-factory.test.ts` to assert `NOT instanceof PostelError`.
- [x] 2.4 Update `@postel/core/README.md` with a short note documenting the deliberate exclusion.

## 3. Validation and archive

- [ ] 3.1 `openspec validate scope-postel-error-to-protocol-failures --strict` green.
- [ ] 3.2 `openspec archive scope-postel-error-to-protocol-failures -y`.
- [ ] 3.3 `openspec validate --all` green.
- [ ] 3.4 `pnpm typecheck` / `test` / `build` green inside `typescript/`.
- [ ] 3.5 Edge bundle still within 50 KB.
