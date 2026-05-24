# 0013 — Drop `@postel/edge` and edge-runtime targeting

- **Status**: Accepted
- **Date**: 2026-05-24
- **Supersedes (in part)**: forward-looking claims about `@postel/edge` and edge-runtime targeting in [ADR 0001](0001-library-shape.md), [ADR 0007](0007-storage-strategy.md), [ADR 0010](0010-typescript-toolchain.md), [ADR 0011](0011-compliance-suite-tooling.md), and [ADR 0012](0012-package-granularity.md).
- **Decision drivers**: live adopter demand, package-count vs receiver-mental-model trade-off, cross-port consistency, pre-1.0 willingness to remove unused contract surface

## Context

`@postel/edge` was introduced as a dedicated receiver-only package targeting Cloudflare Workers, Vercel Edge, Deno Deploy, Bun, and Cloudflare Pages, with a hard ≤ 50 KB minified+gzipped bundle budget. The `receiver` capability spec carried two requirements that contracted this — `Edge bundle size budget` and `Edge runtime portability` — and the `distribution-packaging-typescript` package map listed `@postel/edge` as a peer of `@postel/core`. VISION.md's §3 persona table named an "Edge/serverless engineer" and §7 done criterion #1 was "Does the receiver lib run unmodified on Cloudflare Workers in ≤ 50 KB?".

The factory redesign archived as `2026-05-21-redesign-postel-factory-shape` collapsed the adopter-facing receiver surface into `Postel({ inbound: {...} }).inbound.<source>.verify(...)` in `@postel/core`. From that point on, `@postel/edge` has been an internal implementation detail re-exported verbatim from `@postel/core`. No adopter currently imports `@postel/edge` directly — including no one who would care about its 50 KB budget or its Web-Crypto-only stance.

This ADR re-evaluates whether the edge-runtime carve-out is paying for itself pre-v0.1.0.

## Decision

Delete the `@postel/edge` package. Relocate its source (`verify`, `dedup`, `jwksHandler`, `createKeyset`, `signFixture`, structured errors, types, `ttlToSeconds`, internal Web-Crypto helpers) into `@postel/core`. Remove the `Edge bundle size budget` and `Edge runtime portability` requirements from the `receiver` capability spec. Drop the Edge/serverless engineer persona, the edge-runtime in-scope item, the Cloudflare Worker reference application, and the Cloudflare-Workers-≤-50-KB success criterion from VISION.md.

Edge-runtime support is **not contracted**. The verify path currently uses Web Crypto, which means it would still execute on edge-flavored runtimes that ship Web Crypto, but that is incidental — not a stated contract — and the project does not promise to keep it that way. If demand for an edge-runtime sub-bundle or runtime-portability requirement reappears post-v0.1.0, a future OpenSpec change can reintroduce it, targeted at a concrete adopter rather than a hypothetical one.

## Rationale

1. **Zero live demand.** No adopter has asked for a Cloudflare Workers / Vercel Edge / Deno Deploy deployment pre-v0.1.0. The bundle-size budget is enforcing a constraint nobody is exercising. The Hono framework adapter — the one entry point that could plausibly run on the edge — works fine against the receiver path either way; nothing in `@postel/hono` depends on `@postel/edge` being a separate package.

2. **Two packages for one mental model.** The docs landing snippets, the get-started page, and the TypeDoc reference all show `@postel/core` as the adopter surface. The implementation lives in `@postel/edge`. `@postel/core` depends on `@postel/edge` and re-exports its entire surface verbatim. A reader has to learn that two packages exist and that one of them they should ignore. Collapsing this into one package matches what the docs already say.

3. **Cross-port consistency.** Per [ADR 0005](0005-polyglot-staged-rollout.md), the polyglot Go / Python / Rust receivers are on the road. Those ports will not need a parallel `<lang>/edge` carve-out — their portability stories are different (Go has GOOS targets; Python and Rust have their own runtime conventions). Shipping the TS port with a runtime-target sub-package sets a confusing precedent that doesn't generalize. The cross-port contract is `Postel({ inbound })`, not `@postel/edge`.

4. **Pre-1.0 is the right time to retract.** VISION §8 explicitly frames `0.x` as experimental-semantics. Removing contract surface that has no live consumer is exactly what the experimental phase is for. Post-1.0 this would be a breaking change with a deprecation cycle; today it is one PR and an OpenSpec change.

5. **Less to coordinate.** Per the dist-packaging spec, every `@postel/*` package shares a major version and releases together. Each additional package is permanent release-coordination cost. Dropping `@postel/edge` reduces the published-package count by one without making anything else harder.

## Counter-arguments considered

The strongest argument **against** dropping `@postel/edge`:

> **The edge-runtime persona is in VISION.md.** Removing the persona — and the "Cloudflare Workers ≤ 50 KB" 1.0 done criterion — narrows the project's stated market. That's a real scope change, not a refactor.

This is true. The decision is to narrow the stated market deliberately. The rationale: a persona we can't name a single adopter for is a positioning claim, not a product commitment. Carrying the claim into v0.1.0 implies a contract we haven't validated. Carrying it into 1.0 (the SemVer commitment surface) would lock it in. Removing it now keeps options open — the door is not slammed shut. If a real adopter shows up with a real workload, the persona, the runtime requirement, and a targeted bundle artifact can come back in a future OpenSpec change with their use case as motivation.

Other arguments considered and rejected:

- **"The receiver code already works on edge; why not contract it?"** Free behavior is not free contract. Contracting it commits CI, docs, and future-version compatibility to a target nobody exercises. The behavior remains observable; we simply don't promise it.
- **"It's only 50 KB; the package is small."** Size of the package isn't the cost. Cost is the README, the tsup config, the dedicated CI bundle gate, the docs concept page, the docs guide page, the persona row, the 1.0 done criterion, the cross-references in five capability specs, and the cognitive friction every newcomer pays understanding "what's the difference between `@postel/edge` and `@postel/core`?". Removing all of that is the win.

## Consequences

- `@postel/edge` no longer exists. Its source lives at `typescript/packages/core/src/` alongside the factory, inbound, and strategies modules.
- `@postel/core`'s public API is unchanged for adopters — `Postel({ inbound: {...} }).inbound.<source>.verify(...)` is the same surface, just no longer plumbed through a second package.
- The `receiver` capability spec loses `Edge bundle size budget` and `Edge runtime portability` requirements. Tree-shakeability of the verify path is still guaranteed by `distribution-packaging-typescript`'s `Tree-shakeability` requirement.
- VISION.md loses the Edge/serverless engineer persona, the edge-runtime in-scope item, the Cloudflare Worker reference application, and the Cloudflare-Workers-≤-50-KB success criterion. The §1 problem-statement bullet describing Svix / Hookdeck no longer claims edge support as a Postel differentiator.
- The downstream framework adapter (`@postel/hono`) and the standalone storage dedup adapters (`@postel/storage-standalone-pg`, `@postel/storage-standalone-sqlite`) switch their `@postel/edge` imports to `@postel/core`.
- `scripts/check-edge-bundle.mjs` and its `mise.toml` task entry are deleted. The compliance CI workflow builds and exercises `@postel/core` instead of `@postel/edge`.
- The docs site loses the `concepts/edge-runtimes` and `guides/cloudflare-workers` pages. Other docs pages drop `@postel/edge` and edge-runtime references in favor of the unified `@postel/core` story.
- ADR 0001's edge-runtime persona reasoning, ADR 0007's edge-runtime decision driver and `@postel/edge`-specific dedup carve-out, ADR 0010's `@postel/edge` bundle-budget and runtime-target claims, ADR 0011's `@postel/edge` cross-reference, and ADR 0012's reliance on `@postel/edge` as the runtime-target carve-out are all **superseded in part** by this ADR. Those ADRs are left intact as historical record of the prior decisions.
- This decision is reversible: if edge-runtime demand reappears, a future OpenSpec change can reintroduce a runtime-portability requirement (or a sub-bundle artifact), drawing on the verify code as it lives in `@postel/core`. The Web-Crypto-based implementation is preserved, so the cost of re-targeting edge runtimes later is "add a requirement and a bundle check" — not a rewrite.

## Alternatives considered

### Keep `@postel/edge` but stop documenting it

Rejected. The package would continue to bloat the workspace, the CI matrix, and the release coordination cost without providing any consumer-visible benefit. Hiding it would also mean accepting permanent narrative drift between the spec set and what adopters actually see.

### Keep the `Edge runtime portability` requirement but drop the package

Rejected. The package was the concrete artifact the requirement constrained. Without the package, "portable to edge runtimes" becomes a property of `@postel/core` that nobody is enforcing or exercising. Contracts that aren't enforced atrophy; we'd rather have no contract than a stale one.

### Defer until a polyglot port forces the question

Rejected. Pre-1.0 is the only window in which removing contract surface is free. Once the Go receiver lands and the lockstep release train tightens, removing a TS-side capability becomes a coordinated cross-port operation. Cheaper now.

### Replace `@postel/edge` with a `@postel/core/edge` subpath export

Rejected. A subpath export would carry the same documentation, CI, and persona burden as a separate package, without the package-boundary benefit (which we're saying we don't want anyway). If demand returns, a future change can choose package vs subpath at that point — committing to the subpath shape now would be premature.
