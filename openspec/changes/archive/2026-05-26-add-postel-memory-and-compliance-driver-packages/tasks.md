## 1. Spec deltas

- [ ] 1.1 Write `proposal.md`.
- [ ] 1.2 Write `specs/distribution-packaging-typescript/spec.md` delta — MODIFIED *Package map*.
- [ ] 1.3 Write `language-impact.md`.

## 2. Validation + archive

- [ ] 2.1 `openspec validate add-postel-memory-and-compliance-driver-packages --strict` green.
- [ ] 2.2 `mise run check:all` green.
- [ ] 2.3 `openspec archive add-postel-memory-and-compliance-driver-packages -y` — auto-sync delta into the main `distribution-packaging-typescript` spec.
- [ ] 2.4 Re-run `openspec validate --all` green after archive.

## 3. Implementing PRs (out of scope for this change — listed for traceability)

- [ ] 3.1 PR-T1 creates `typescript/packages/memory/` per the in-memory `Storage` interface implementation.
- [ ] 3.2 PR-T5 creates `typescript/packages/compliance-driver/` per the *Sender-side compliance driver mechanism* requirement to be introduced in the compliance v0.2 OpenSpec change.
