## Why

Implementing the Postel sender end-to-end at v0.2.0 needs two new TS packages that don't yet appear in the canonical [Package map](../../specs/distribution-packaging-typescript/spec.md): an in-memory `Storage` adapter (used as the only persistent backing for v0.2.0 sender work, plus as the deterministic test backend across the test suite) and a compliance control-plane driver (the HTTP shim the future Go `compliance` runner drives in `--sender-control` mode per the v0.2.0 sender-side compliance track). Without these rows in the Package map the [distribution-packaging-typescript / Importing a storage adapter does not pull other adapters](../../specs/distribution-packaging-typescript/spec.md) scenario can't enumerate them, the docs site's [packages reference](../../../docs/content/docs/reference/packages.mdx) can't list them, and the PR landing each package can't pass `mise run check:all` because the spec hasn't sanctioned the package.

## What Changes

- Add `@postel/memory` to the Tier-1 storage adapter list in `distribution-packaging-typescript` *Package map*. Adapter category: `standalone` (owns its in-process state — no DB connection). Used as both the sender-runtime backing for in-process demos / single-binary OSS hosts and the deterministic test backend the rest of the workspace depends on.
- Add `@postel/compliance-driver` to the Auxiliary list in *Package map*. Exposes the HTTP control-plane API ([sender-side compliance driver mechanism](../../specs/compliance/spec.md) when that requirement lands) the suite's sender-mode runner drives. Distinct from `@postel/test` (which is for adopter unit tests) and from `@postel/cli` (which is the adopter-facing user CLI) because the driver's stability surface is a CONTRACT artifact tracked by the compliance suite's lockstep version, not by adopters.
- Update the *Importing a storage adapter does not pull other adapters* scenario to list `@postel/memory` alongside the other Tier-1 adapter packages.
- No requirement removals. No breaking changes to existing scenarios.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`distribution-packaging-typescript`**:
  - `Package map` — two rows added (`@postel/memory` under Tier-1 storage adapters, `@postel/compliance-driver` under Auxiliary). One scenario updated to list `@postel/memory` in the adapter-isolation example.

## Wire-format / DB-schema impact

Wire-format: unchanged.
DB-schema: unchanged.

## Impact

- `openspec/specs/distribution-packaging-typescript/spec.md` — *Package map* requirement gains two package rows; *Importing a storage adapter does not pull other adapters* scenario gains `@postel/memory` in the isolation list.
- `typescript/packages/memory/` — new directory created by the PR that lands the package (PR-T1 in the implementation plan).
- `typescript/packages/compliance-driver/` — new directory created by the PR that lands the package (PR-T5 in the implementation plan).
- `typescript/pnpm-workspace.yaml` — already includes `packages/*` recursively; no edit required.
- `docs/content/docs/reference/packages.mdx` — two rows added in the same PRs that introduce each package, per [AGENTS.md rule 8](../../../AGENTS.md).
- No code, CI, ADR, or VISION changes carry on this OpenSpec change itself — those flow with the implementing PRs.
