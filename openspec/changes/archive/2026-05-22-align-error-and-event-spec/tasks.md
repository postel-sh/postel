## 1. Author the spec delta

- [x] 1.1 Write `proposal.md`.
- [x] 1.2 Write `specs/api-surface-typescript/spec.md` delta — MODIFIED for the two requirements.

## 2. Implementation

- [x] 2.1 Add `"NOT_IMPLEMENTED"` to `PostelErrorCode` in `@postel/edge`.
- [x] 2.2 Change `NotImplementedError` in `@postel/core` to extend `PostelError` with `code: "NOT_IMPLEMENTED"`.
- [x] 2.3 Add a test asserting `NotImplementedError instanceof PostelError` and `.code === "NOT_IMPLEMENTED"`.

## 3. Validation and archive

- [ ] 3.1 `openspec validate align-error-and-event-spec --strict` green.
- [ ] 3.2 `openspec archive align-error-and-event-spec -y`.
- [ ] 3.3 `openspec validate --all` green.
- [ ] 3.4 `pnpm typecheck` / `test` / `build` green inside `typescript/`.
- [ ] 3.5 Edge bundle still within 50 KB budget.
