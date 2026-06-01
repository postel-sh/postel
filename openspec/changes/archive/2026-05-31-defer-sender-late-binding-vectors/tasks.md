## 1. Spec delta

- [ ] 1.1 Write `proposal.md`.
- [ ] 1.2 Write `specs/compliance/spec.md` delta — MODIFY *v0.2.0 sender-side initial test scope* (drop late-binding row + sub-category, ~28/10) and *Out-of-scope behaviors at the current MINOR* (add late-binding-via-update).
- [ ] 1.3 Write `language-impact.md`.

## 2. Code revert

- [ ] 2.1 Remove `update_endpoint` / `target` from `compliance/schema/vector.schema.json` and `compliance/cli/vector.go`.
- [ ] 2.2 Remove the `/control/endpoints/update` route + its driver test.
- [ ] 2.3 Delete `compliance/vectors/sender/late-binding/`.
- [ ] 2.4 Update `compliance/CHANGELOG.md` enumeration to ~28 / 10 sub-categories.

## 3. Validation + archive

- [ ] 3.1 `openspec validate defer-sender-late-binding-vectors --strict` green.
- [ ] 3.2 `go test ./...`, `pnpm typecheck/test/lint/build`, `mise run check:all` green.
- [ ] 3.3 `openspec archive defer-sender-late-binding-vectors -y`.
- [ ] 3.4 Re-run `openspec validate --all` green after archive.
