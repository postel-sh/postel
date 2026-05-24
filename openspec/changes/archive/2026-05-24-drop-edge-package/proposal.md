## Why

`@postel/edge` was introduced as a dedicated receiver-only package targeting edge runtimes (Cloudflare Workers, Vercel Edge, Deno Deploy) with a hard ≤ 50 KB minified+gzipped bundle budget. After the [factory redesign](../archive/2026-05-21-redesign-postel-factory-shape/proposal.md), the receiver surface adopters actually use is `Postel({ inbound: {...} }).inbound.<source>.verify(...)` from `@postel/core` — `@postel/edge` is now an internal implementation detail re-exported from core, not a package adopters import directly.

Three concrete problems follow:

1. **Two packages for one mental model.** The docs show `@postel/core` snippets; the implementation lives in `@postel/edge`; the `@postel/core` package depends on `@postel/edge` and re-exports its surface verbatim. A reader has to learn both packages exist and that they should ignore one of them. Cross-port consistency suffers — the polyglot Go / Python / Rust receivers do not need a parallel `<lang>/edge` carve-out, and shipping with one in TS sets a confusing precedent.
2. **No live demand for the edge-runtime target.** Pre-v0.1.0, no adopter has asked for a Cloudflare Workers / Vercel Edge / Deno Deploy deployment. The bundle-size budget is enforcing a constraint nobody is exercising. The Hono adapter — the one framework adapter that runs on edge today — works fine against the verify path either way.
3. **Surface that costs more than it earns.** A separate package means a separate README, a separate tsup build, a separate place to look up tests, a separate bundle-budget CI gate, dedicated docs concept and guide pages, and `@postel/edge`-specific phrasing in five capability specs + VISION's persona / problem statement / 1.0 done criterion #1 / adoption goals. None of that is paying for itself.

This change deletes `@postel/edge` and removes edge-runtime targeting from the project's surface. The verify / dedup / JWKS / keyset / sign-fixture implementation moves into `@postel/core` directly. The receiver capability stops claiming edge-runtime portability and the 50 KB budget; the `Postel({ inbound })` surface is the only adopter-facing receiver entry point. If demand for edge-runtime support resurfaces post-v0.1.0, a future OpenSpec change can reintroduce a runtime-portability requirement (or a sub-bundle) targeted at actual user need.

## What Changes

- Delete the `@postel/edge` package. Its source (`verify`, `dedup`, `jwksHandler`, `createKeyset`, `signFixture`, structured errors, types, `ttlToSeconds`, internal Web Crypto helpers) moves into `@postel/core/src/`.
- Remove the `Edge bundle size budget` and `Edge runtime portability` requirements from `receiver`.
- Remove `@postel/edge` from the `distribution-packaging-typescript` package map.
- Update the `compliance` and `standard-webhooks-compliance` reference-receiver scenarios from "the TS edge build" / `@postel/edge` to `@postel/core`.
- Update `api-surface-typescript`'s `Conditional optionality of outbound and inbound` requirement: drop the "edge-only consumer" phrasing in favor of "receiver-only consumer" — the conditional optionality is unchanged, only the example label is.
- Update `storage-layer`'s helper-package and adapter-degradation scenarios: drop "importable from edge runtimes if needed" and the hypothetical "edge KV-backed dedup-only adapter" example.
- VISION.md is updated separately in the same PR (per AGENTS.md rule 6, scope shift): remove the Edge/serverless engineer persona, drop edge-runtime from in-scope, replace the "Cloudflare Workers ≤ 50 KB" #1 done criterion, drop the Cloudflare Worker example from adoption goals, and rewrite the problem-statement bullet that frames edge support as a Postel differentiator vs Svix / Hookdeck.
- A new ADR 0013 records this decision and notes which forward-looking claims in ADRs 0001 / 0010 / 0011 / 0012 it supersedes. Existing ADRs are left intact as historical record.

Downstream code changes that follow from the spec deltas:

- `@postel/hono`, `@postel/storage-standalone-pg`, `@postel/storage-standalone-sqlite` switch their `@postel/edge` imports to `@postel/core`.
- `.github/workflows/compliance-suite.yml`, `typescript/scripts/smoke-receiver.mjs`, and `typescript/scripts/reference-receiver.mjs` build and exercise `@postel/core` instead of `@postel/edge`.
- `scripts/check-edge-bundle.mjs` is deleted; its `mise.toml` task entry too if present.
- Docs pages `docs/content/docs/guides/cloudflare-workers.mdx` and `docs/content/docs/concepts/edge-runtimes.mdx` are deleted; remaining `docs/content/docs/**` pages, landing snippets in `docs/app/(home)/page.tsx`, and the TypeDoc-generation script lose edge / `@postel/edge` references.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`receiver`**:
  - `Verify returns parsed event or structured error` — Purpose paragraph rewritten to drop the edge / 50 KB claim.
  - **Removed**: `Edge bundle size budget`.
  - **Removed**: `Edge runtime portability`.
- **`api-surface-typescript`**:
  - `Conditional optionality of outbound and inbound` — body wording updated, scenarios unchanged.
- **`distribution-packaging-typescript`**:
  - `Package map` — `@postel/edge` entry removed; "Importing edge does not pull core" scenario removed.
- **`compliance`**:
  - `Suite identity — vendor-neutral oracle for CONTRACT-level behavior` — `Run against the first-party reference port` scenario updated from "the TS edge build today" to "the TS core build today".
  - `v0.1.0 initial test scope — receiver-side wire-format and signing behavior` — `Edge bundle size budget` and `Edge runtime portability` removed from the structurally-untestable list (the requirements they refer to are being removed).
  - `v0.1.0 explicit out-of-scope — sender-side behavior` — Cross-reference to VISION §7 #1 (Cloudflare Workers ≤ 50 KB) is updated to reference the renumbered list (and the edge clause itself drops).
- **`standard-webhooks-compliance`**:
  - `Compliance test suite` — `Run suite against own implementation` scenario updated from `@postel/edge` to `@postel/core`.
- **`storage-layer`**:
  - `Helpers package for adapter authors` — `Helpers package has no DB dependency` scenario drops the "importable from edge runtimes if needed" qualifier.
  - `Host transaction passthrough` — `Adapter without real transaction support degrades gracefully` scenario rephrases the example to a generic "backend without real transactions" instead of "edge KV-backed dedup-only adapter".

### Removed Capabilities

None.

## Wire-format / DB-schema impact

Wire-format: unchanged.
DB-schema: unchanged.

## Impact

- `openspec/specs/receiver/spec.md` — two requirements removed, purpose paragraph rewritten.
- `openspec/specs/api-surface-typescript/spec.md` — one requirement body rewritten.
- `openspec/specs/distribution-packaging-typescript/spec.md` — package map shortened, one scenario removed.
- `openspec/specs/compliance/spec.md` — one scenario updated, structurally-untestable list shortened, VISION cross-reference updated.
- `openspec/specs/standard-webhooks-compliance/spec.md` — one scenario updated.
- `openspec/specs/storage-layer/spec.md` — two scenarios rephrased.
- `VISION.md` — persona dropped, in-scope shortened, 1.0 done criteria renumbered, adoption-goal Cloudflare example removed, problem-statement bullet rewritten.
- `decisions/0013-drop-edge-package-and-runtime-targeting.md` — new ADR.
- `typescript/packages/edge/` — directory deleted.
- `typescript/packages/core/src/` — gains `verify.ts`, `dedup.ts`, `errors.ts`, `jwks-handler.ts`, `keyset.ts`, `sign-fixture.ts`, `ttl.ts`, `types.ts`, and `internal/` (relocated from edge). Existing `core/src/errors.ts` merges with the relocated edge errors. `inbound.ts` imports from local modules instead of `@postel/edge`. `package.json` drops the `@postel/edge` workspace dependency.
- `typescript/packages/core/test/` — gains the relocated edge test files (`dedup.test.ts`, `jwks-handler.test.ts`, `keyset.test.ts`, `log-elision.test.ts`, `sign-fixture.test.ts`, `timing.test.ts`, `verify-keyset.test.ts`, `verify.test.ts`).
- `typescript/packages/frameworks/hono/`, `typescript/packages/storage/standalone-pg/`, `typescript/packages/storage/standalone-sqlite/` — imports rewritten from `@postel/edge` to `@postel/core`; `package.json` dependency updated.
- `typescript/scripts/smoke-receiver.mjs`, `typescript/scripts/reference-receiver.mjs` — import path updated, build target updated.
- `scripts/check-edge-bundle.mjs` — deleted.
- `scripts/spec-drift-deferred.txt` — header text and any `@postel/edge`-specific clauses updated.
- `.github/workflows/compliance-suite.yml` — job name and `pnpm --filter` target updated; path filter for `scripts/check-edge-bundle.mjs` removed.
- `mise.toml` — bundle-check task removed if present; comment text updated if needed.
- `docs/` — `cloudflare-workers.mdx` and `edge-runtimes.mdx` deleted; remaining pages updated; landing-page snippets updated; TypeDoc-generation script updated to point at `@postel/core` exports only.
- `typescript/AGENTS.md`, root `README.md`, `compliance/README.md`, `compliance/CHANGELOG.md`, `compliance/vectors/jwks/public-only.yaml` — `@postel/edge` and edge-runtime references removed.
