## Why

The in-memory `Storage` adapter was introduced as a standalone `@postel/memory` package by [`add-postel-memory-and-compliance-driver-packages`](../../changes/archive/2026-05-26-add-postel-memory-and-compliance-driver-packages/proposal.md). In practice that placement forces an awkward split: because `@postel/core` cannot depend on `@postel/memory` (the build graph rejects the cycle), the entire sender-runtime test suite has to live in `@postel/memory` rather than next to the sender code it exercises in `@postel/core`. A contributor asking "how many tests does core have, and what do they cover?" gets a misleading answer — core's tests are receiver-only, and the sender behavior is verified in a different package.

The receiver side already sets the precedent for the fix: its in-memory dedup adapter (`inMemoryDedupAdapter` / `InMemoryDedup`) ships **inside `@postel/core`**, not as a separate package. The in-memory storage adapter is the same kind of artifact — the reference implementation, the deterministic test backend, and the zero-config default — so it belongs in core too. Persistent adapters (`@postel/standalone-pg`, `@postel/drizzle`, …) remain separate packages per [ADR 0007](../../../decisions/0007-storage-strategy.md); only the in-memory reference moves in.

## What Changes

- Remove `@postel/memory` from the `distribution-packaging-typescript` *Package map*. The in-memory storage adapter (`InMemoryStorage`, `InMemoryTx`) now ships from `@postel/core` directly, alongside the existing in-memory dedup adapter.
- Update the *Importing a storage adapter does not pull other adapters* scenario to drop `@postel/memory` from the isolation list (it no longer exists as a separate package).
- The tree-shakeability guarantee is unchanged and explicitly preserved: `InMemoryStorage` is a leaf export not reachable from the receiver (`verify`) import graph, so a receiver-only bundle still excludes it.
- No requirement is added or removed. No behavior changes. The sender-runtime test suite moves from `typescript/packages/memory/test/` into `typescript/packages/core/test/`; `@postel/compliance-driver` imports `InMemoryStorage` from `@postel/core`; the `typescript/packages/memory/` directory is deleted.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`distribution-packaging-typescript`**:
  - `Package map` — `@postel/memory` row removed; a note records that the in-memory storage adapter ships from `@postel/core`. The *Importing a storage adapter does not pull other adapters* scenario drops `@postel/memory` from the list.

## Wire-format / DB-schema impact

Wire-format: unchanged.
DB-schema: unchanged.

## Impact

- `openspec/specs/distribution-packaging-typescript/spec.md` — *Package map* requirement: one row removed, one scenario updated.
- `typescript/packages/core/src/storage/memory/` — new: `adapter.ts`, `mutex.ts`, `tx.ts` (relocated from `@postel/memory`).
- `typescript/packages/core/src/index.ts` — exports `InMemoryStorage`, `InMemoryStorageOptions`, `InMemoryTx`.
- `typescript/packages/core/tsconfig.json` — includes `test/**` so the type-flow (`@ts-expect-error`) tests are typechecked.
- `typescript/packages/core/test/` — gains the relocated sender-runtime test files.
- `typescript/packages/compliance-driver/` — imports `InMemoryStorage` from `@postel/core`; drops the `@postel/memory` dependency.
- `typescript/packages/memory/` — deleted.
- `typescript/pnpm-lock.yaml` — regenerated.
