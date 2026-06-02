## Why

The compliance suite is a behavioral oracle, and in practice it is the *leading edge*: a new requirement lands in the suite first, and each port implements it afterward, releasing the matching MINOR on its own schedule. The current `Lockstep versioning with the @postel/* release train` requirement forbids exactly that — it mandates that the suite and every `@postel/*` port "release together at each MINOR cut," and its scenario *Suite and ports share `X.Y`* asserts "every `@postel/*` port package released alongside it also takes version `X.Y.0`."

That makes the suite-leads-ports-follow reality a spec violation, and it forces simultaneous releases the project does not actually perform (it would require the TypeScript port to ship a MINOR the same day the suite does, even when the port hasn't implemented the new requirement yet). The version-*match* invariant is right and worth keeping; the simultaneous-*timing* mandate is wrong.

This change relaxes release timing during the `0.x` line while preserving the shared version line, the version-match rule, and VISION §8's coordinated-major intent.

## What Changes

- **Kept CONTRACT:** the shared `MAJOR.MINOR` version line and the version-match rule — a port at `X.Y.Z` passes `compliance@X.Y.*` end-to-end before release.
- **Relaxed:** pre-1.0, the suite **leads**; ports adopt MINORs on their own schedule; the suite's latest released version MAY be ahead of any port's latest release. Release timing is independent per artifact. (Was: "release together at each MINOR cut.")
- **Preserved:** MAJOR boundaries (`1.0.0` and later) remain a **coordinated cut** — the suite and all ports release the major together. This is VISION §8's existing "release together" rule, now scoped to majors.
- **Clarified:** "lockstep" means the version *numbers* move in step (matched conformance), not that releases happen simultaneously.
- The simultaneous-release scenario (*Suite and ports share `X.Y`*) is replaced by two scenarios: *Pre-1.0, the suite leads and ports converge on their own schedule* and *Major boundary is a coordinated cut*. The other five scenarios are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`compliance`**:
  - `Lockstep versioning with the @postel/* release train` — body relaxed to suite-leads-pre-1.0 + coordinated-major-cut; the simultaneous-release scenario replaced by two new scenarios. The version-match rule, MAJOR-bump discipline, and distribution-channel openness are unchanged. The requirement **title is retained** (it is referenced by name from `v0.2.0 sender-side initial test scope`, and "lockstep" still describes the shared/matched version line).

## Wire-format / DB-schema impact

Wire-format: unchanged.
DB-schema: unchanged.

## Impact

- `openspec/specs/compliance/spec.md` — one requirement modified (body + scenarios). It stays in `scripts/spec-drift-deferred.txt` under the same title; no test mapping changes.
- `VISION.md` §8 — the "Compliance suite versioning is lockstep" sentence is refined to state pre-1.0 independent timing + coordinated major; the existing "From 1.0 onward … release together" sentence already aligns.
- Tooling (carried by the same PR, **not** this spec change): the release flow's version-equality guard is replaced by a per-release conformance guard (a `ts/vX.Y.Z` release runs the corpus at `compliance/vX.Y.Z`); ADR 0014 rewritten. Tracked on PR #43.
