## Why

Two `filtering-transformation` requirements in the v0.2.0 sender-compliance contract table describe **code-side callback** behavior that fundamentally can't be driven over the HTTP control plane: "Transform produces body to send" (a transform is a host function) and "Filter and transform errors fail closed" (requires a throwing host function). The `transform-reshapes-body` vector was a no-op — it registered a normal endpoint with no transform and asserted nothing about a reshaped body — so the corpus would not catch a broken transform. These behaviors belong to per-port unit tests, not the cross-port wire-driven corpus (the same line already drawn for late binding and DNS-rebinding).

## What Changes

- Replace the `sender/filtering/transform-reshapes-body` vector with `sender/filtering/channel-filter-no-match` (a drivable negative-case channel filter). `sender/filtering/*` stays at 4 vectors; the corpus total stays ~28.
- Drop "Transform produces body to send" and "Filter and transform errors fail closed" from the v0.2.0 contract-set table — neither is corpus-coverable over the control plane. Both remain covered by the reference port's unit suite (transforms/predicate filters are settable via `endpoints.create({ transform, filter })`, and the dispatcher fails closed on a throwing callback).
- Add both to the deferred list in `Out-of-scope behaviors at the current MINOR`, noting they are code-side-callback behaviors covered by per-port unit tests.
- (Carried by the same PR, not this spec change) the `Filter and transform errors fail closed` TS test stops being a placeholder and becomes a real assertion (a throwing transform → failed attempt, no infinite retry).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`compliance`**:
  - `v0.2.0 sender-side initial test scope` — contract-set table drops the two code-side `filtering-transformation` rows; the `transform-reshapes-body` enumeration entry becomes `channel-filter-no-match` (filtering stays 4, total ~28); a note records that transform / fail-closed are unit-covered, not corpus-covered.
  - `Out-of-scope behaviors at the current MINOR` — the `filtering-transformation` deferred line names transform-produces-body and fail-closed alongside late-binding-at-dispatch.

## Wire-format / DB-schema impact

Wire-format: unchanged.
DB-schema: unchanged.

## Impact

- `openspec/specs/compliance/spec.md` — two requirements modified.
- `compliance/vectors/sender/filtering/transform-reshapes-body.yaml` → renamed/rewritten to `channel-filter-no-match.yaml`.
- `compliance/CHANGELOG.md` — enumeration note updated.
- `typescript/packages/core/test/` — the fail-closed placeholder becomes a real test.
