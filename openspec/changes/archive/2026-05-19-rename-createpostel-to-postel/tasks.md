## 1. Author the spec deltas

- [x] 1.1 Write `proposal.md` with Why / What Changes / Capabilities / Impact.
- [x] 1.2 Write `specs/api-surface-typescript/spec.md` delta — RENAMED + MODIFIED for the factory requirement.
- [x] 1.3 Write `specs/storage-layer/spec.md` delta — MODIFIED scenario bodies in `Adapter matrix with three categories`.

## 2. Update non-spec files in this PR

- [x] 2.1 Update `typescript/AGENTS.md` adopter-facing example from `createPostel(...)` to `Postel(...)`.
- [x] 2.2 Update `decisions/0012-package-granularity.md` to reference `Postel` instead of `createPostel`.

## 3. Validation and archive

- [x] 3.1 `openspec validate rename-createpostel-to-postel --strict` green.
- [x] 3.2 `openspec archive rename-createpostel-to-postel -y` — applies the deltas to `openspec/specs/api-surface-typescript/spec.md` and `openspec/specs/storage-layer/spec.md`; moves the change folder under `openspec/changes/archive/`.
- [x] 3.3 Direct-edit `openspec/specs/api-surface-typescript/spec.md` Purpose paragraph: `createPostel` → `Postel`. (Purpose sections are outside the OpenSpec delta surface; this is a coordinated direct edit applied at archive time within the same PR.)
- [x] 3.4 Update `scripts/spec-drift-deferred.txt`: `createPostel factory returns the library instance` → `Postel factory returns the library instance`.
- [x] 3.5 `node scripts/check-spec-drift.mjs` green (no orphan deferrals, no untracked requirements).
- [x] 3.6 `mise run check:all` green (spec validate + schema validate + drift).
