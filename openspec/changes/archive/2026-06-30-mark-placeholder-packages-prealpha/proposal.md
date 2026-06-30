## Why

Milestone **M1 — Truth & Trust** (go-live blocker). Issue #79: `@postel/effect`, `@postel/test`, `@postel/nextjs`, and `@postel/bun` export only `__postelPackage` — an empty, unusable surface. They are already `private: true` in their `package.json` (so `pnpm publish -r` skips them), but nothing *enforces* that invariant: a future change could flip one public and ship an empty package into the 1.0 inventory, and the `distribution-packaging-typescript` *Package map* lists all four as if they were shippable.

This change makes the pre-alpha status explicit and durable: a spec requirement plus a guard test that fails CI if any package whose only export is `__postelPackage` is not `private`.

## What Changes

- **distribution-packaging-typescript**
  - ADD `Empty placeholder packages are pre-alpha and unpublished` [PORT-SPECIFIC] — a package whose only export is `__postelPackage` MUST be `private` and is NOT counted in the 1.0 published package set. Names the current four (`@postel/effect`, `@postel/test`, `@postel/nextjs`, `@postel/bun`).
  - MODIFY `Package map` — annotate those four as pre-alpha placeholders so the map no longer reads as if they ship.
- **api-surface-typescript**
  - MODIFY `Effect-TS layer` — interim note: `@postel/effect` is a pre-alpha placeholder (private, not in the 1.0 set) until the Effect adapter ships.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `distribution-packaging-typescript` — one ADDED requirement (placeholder guard), one MODIFIED requirement (Package map annotation).
- `api-surface-typescript` — one MODIFIED requirement (Effect-TS layer pre-alpha note).

### Removed Capabilities

None.

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: unchanged. This is packaging metadata + a guard test.

## Impact

- No `package.json` change needed — the four are already `private: true`; this codifies and guards that.
- `typescript/packages/core/test/distribution-packaging.test.ts` — new guard test naming the ADDED requirement: it walks every workspace `package.json`, detects packages whose `src/index.ts` exports only `__postelPackage`, and asserts each is `private`.
- `docs/content/docs/reference/packages.mdx` — add `@postel/effect` to the pre-alpha/stub listing (currently absent) and align the framing.
- `Package map` and `Effect-TS layer` stay in `scripts/spec-drift-deferred.txt` (their full surfaces are still deferred); the new placeholder-guard requirement is covered by the new test.
