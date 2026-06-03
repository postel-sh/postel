## 1. Spec delta

- [ ] 1.1 Write `proposal.md`.
- [ ] 1.2 Write `specs/compliance/spec.md` delta — MODIFY *Lockstep versioning with the `@postel/*` release train*: suite-leads pre-1.0, independent MINOR/PATCH timing, coordinated MAJOR cut; replace the *Suite and ports share `X.Y`* scenario with *Pre-1.0, the suite leads…* and *Major boundary is a coordinated cut*.
- [ ] 1.3 Write `language-impact.md`.

## 2. VISION

- [ ] 2.1 Refine `VISION.md` §8 "Compliance suite versioning is lockstep" sentence (pre-1.0 independent timing, coordinated major); confirm the "From 1.0 onward … release together" sentence still holds; soften the §8 closing "lockstep release coordination" phrasing.

## 3. Validation + archive

- [ ] 3.1 `openspec validate relax-compliance-lockstep-timing --strict` green.
- [ ] 3.2 `mise run check:all` green (the requirement stays in the deferred list, same title — no drift).
- [ ] 3.3 `openspec archive relax-compliance-lockstep-timing -y`.
- [ ] 3.4 `openspec validate --all` green after archive.

## 4. Downstream (separate, same PR — not this spec change)

- [ ] 4.1 Rework the release flow to the conformance guard + GitHub-Release-driven model; rewrite ADR 0014.
