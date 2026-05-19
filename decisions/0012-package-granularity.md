# 0012 — Package granularity: unified `@postel/core` over split sender/receiver packages

- **Status**: Accepted
- **Date**: 2026-05-18
- **Decision drivers**: factory and type-surface coherence, shared wire-format code, tree-shakeability as a sufficient substitute for package-level splitting, alignment with the TS ecosystem's flat-scope convention, release-coordination cost

## Context

The [`distribution-packaging-typescript` spec](../openspec/specs/distribution-packaging-typescript/spec.md) declares `@postel/core` as a single package containing **sender, receiver, types, and errors** — both directions of the library live together. A natural alternative is to split it into `@postel/sender` and `@postel/receiver`, mirroring the per-language polyglot rollout (where receivers ship before senders per [ADR 0005](0005-polyglot-staged-rollout.md)) and the on-disk shape of the planned Go port (`go/receiver/`, `go/sender/`).

This question wasn't argued out in a prior ADR — the unified shape was implicit in the original package map. The split is plausible enough that newcomers ask. This ADR captures the rationale so the question doesn't get re-litigated by everyone who notices it.

## Decision

`@postel/core` stays unified: one npm package containing both sender and receiver code paths, sharing a single `Postel` factory, a single `PostelError` hierarchy, and the Standard Webhooks codec used by both directions. We do **not** ship `@postel/sender` and `@postel/receiver` as separate npm packages.

The size-budget case that would otherwise motivate a split — "I want only the receiver and a tiny bundle on an edge runtime" — is already addressed by `@postel/edge` (≤ 50 KB, receiver + JWKS consumer, runtime-target carve-out). The Node-only "I want only the receiver" case is addressed by tree-shaking: per the dist-packaging spec's "verify is standalone" scenario, `import { verify } from '@postel/core'` excludes the worker, dispatcher, and DB adapters from the consumer's bundle. The remaining cost of installing `@postel/core` for a receive-only Node consumer is `node_modules` disk space, not bundle size.

## Rationale

The strongest arguments against splitting:

1. **The factory is unified.** [api-surface-typescript](../openspec/specs/api-surface-typescript/spec.md) requires `Postel({ db, ...opts })` to return one instance carrying both `send` and `verify` (plus `start`, `endpoints`, `keys`, `dedup`, `jwksHandler`, …). Splitting at the package level would force either two factories (`Sender` + `Receiver`, breaking the "one Postel instance" mental model) or a third "umbrella" package that depends on both — multiplying package count without simplifying the consumer surface.

2. **The error hierarchy spans both directions.** [`PostelError` and its subclasses](../openspec/specs/api-surface-typescript/spec.md) include both receiver errors (`SignatureInvalid`, `TimestampTooOld`, `MalformedHeader`, `UnknownKeyId`, `RawBytesMismatchDetected`) and sender errors (`SsrfBlocked`, `EndpointValidation`, `IdempotencyKeyConflict`, `EndpointDisabled`). The Standard Webhooks event shape (`{ type, timestamp, data, channels?, version? }`) is identical at both ends. Splitting requires either a `@postel/shared` package both depend on (more packages to coordinate) or duplication of the type/error code in each package (drift risk in the contract-level surface that [ADR 0008](0008-conformance-levels.md) explicitly nominates as CONTRACT).

3. **The wire-format codec is shared.** The sender signs, the receiver verifies — same HMAC scheme, same header parsing, same canonical-string construction. Keeping these implementations co-located in one package means there is exactly one place where the Standard Webhooks signature contract lives in the TS port. A split forces this code into either a third package or duplication.

4. **`@postel/edge` already addresses the size-budget case.** The reason to want a separate `@postel/receiver` would be to ship a smaller bundle. But adopters who care about bundle size are by definition on edge or serverless runtimes — exactly the case `@postel/edge` exists for. Adopters on Node servers (where bundle size is irrelevant and `node_modules` footprint is cheap) gain nothing from a per-direction package split.

5. **TS ecosystem convention is flat scopes with subpath exports / tree-shaking.** Drizzle ships schema + query + migrate in one package. Prisma ships client + schema + migrate similarly. Hono ships routing + middleware + helpers as one. Effect ships dozens of concerns through one entry point. The flat-scope-plus-tree-shaking model is the dominant pattern in modern TS libraries that span multiple concerns. Mirroring the Go port's directory shape (`go/receiver/`, `go/sender/`) into the npm scope would be ecosystem-incorrect — Go uses sibling packages because Go convention requires it; npm doesn't.

6. **Release coordination cost.** The dist-packaging spec already requires "shared major version across packages" — every `@postel/*` package bumps together. Adding two more packages to the coordinated release train (with their own changelogs, their own publishing pipelines, their own version pins in consumer apps) is permanent overhead in exchange for a benefit that tree-shaking already provides.

## Counter-arguments considered

The strongest argument **for** splitting was operational: a `@postel/receiver` could ship in v0.1.0 today while `@postel/sender` waits for v0.2.0, neatly matching the receiver-first polyglot rollout per [ADR 0005](0005-polyglot-staged-rollout.md). Under the unified-`@postel/core` model, `@postel/core` either ships partially (only the receiver half implemented, sender half stubbed) or waits until both halves are complete.

This is a real friction, but it's a release-management problem, not a package-shape problem. We solve it by having `@postel/edge` carry the receiver-only v0.1.0 (already its purpose) and letting `@postel/core` ship when both halves are ready. The cost is that the "receiver-only on Node" case is served by `@postel/edge` rather than by a package whose name matches its role — minor and one-time.

The other arguments for splitting — symmetry with Go's `receiver/` + `sender/` layout, clearer per-package purpose — are aesthetic. They don't outweigh the concrete costs in points 1–6.

## Consequences

- `@postel/core` is the canonical home for both sender and receiver code paths once the sender lands (v0.2.0+). The receiver implementation currently in `@postel/edge` is re-exposed via `@postel/core` at that point (likely as a shared internal module that both packages re-export, not by duplication).
- `@postel/edge` continues to exist as the runtime-target carve-out (≤ 50 KB, Web APIs only, receiver + JWKS consumer + JWKS publisher primitive). The boundary between `@postel/core` and `@postel/edge` is **bundle budget and runtime APIs**, not direction.
- Some primitives sit at the intersection and need explicit placement decisions — `jwksHandler` is the current example (producer-side primitive currently in `@postel/edge` for pragmatic reasons; flagged in [`typescript/packages/edge/README.md`](../typescript/packages/edge/README.md) for migration to `@postel/core` when the sender lands). Future intersection cases (Web Crypto vs node:crypto code paths, fetch vs undici, etc.) follow the same rule: the canonical implementation lives in `@postel/core`, with `@postel/edge` carving out the runtime-neutral subset.
- Adopters who want receiver-only on Node install `@postel/core` and rely on tree-shaking, or install `@postel/edge` if the size budget matters. Both are documented in the get-started flow.
- This decision is reversible if operational reality contradicts it — specifically if the receiver and sender end up with such different release cadences or runtime requirements that the unified package becomes a coordination bottleneck. The marker is concrete: if sender-side breaking changes start gating receiver patch releases (or vice versa) more than once or twice, revisit. Pre-1.0 we have room to change shape via the `0.x` minor-can-break clause; post-1.0 a split would require a major bump for the package surface change.

## Alternatives considered

### `@postel/sender` + `@postel/receiver` as separate npm packages

Rejected for the six reasons above. Would let v0.1.0 ship a "receiver" package whose name matches its role, but at the permanent cost of duplicated codec/types/errors or a third coordinating package, plus loss of the unified `Postel` factory.

### Three-package shape: `@postel/sender` + `@postel/receiver` + `@postel/shared`

Rejected. Solves the duplication risk in the two-package split by introducing a third package that consumers don't directly install but transitively depend on. Adds a publishing step and version pin without improving the consumer surface compared to the unified `@postel/core`.

### Single package per concern, ten or more packages

Rejected without serious consideration. The TS ecosystem does not converge on per-concern micro-packages for libraries of this scope; the maintenance overhead is not justified by any concrete consumer benefit.

### Defer the decision

Rejected. The question keeps surfacing in design discussions and the implicit "unified" answer was being treated as un-argued by newcomers. Recording the decision now is cheaper than re-arguing it every time someone notices the asymmetry with the Go port layout.
