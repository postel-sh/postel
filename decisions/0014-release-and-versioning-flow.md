# 0014 — Release and versioning flow (lockstep npm + Go compliance suite)

- **Status**: accepted
- **Date**: 2026-06-02
- **Decision drivers**: the cross-port lockstep version requirement (VISION.md §8) must hold from the *first* release; two ecosystems ship together (npm registry + a Go binary); single-vendor team at pre-1.0; the repo is already mise-orchestrated with Conventional Commits and OpenSpec as the canonical change record

## Context

[VISION.md §8](../VISION.md) makes version coordination a CONTRACT: `@postel/compliance` shares `MAJOR.MINOR` with every `@postel/*` package, and the `@postel/*` packages share a major and release together. The [`distribution-packaging-typescript`](../openspec/specs/distribution-packaging-typescript/spec.md) spec fixes the package map and the SemVer discipline but says nothing about the *mechanism* that executes a release. That gap is this ADR.

The constraint that drives the shape: lockstep is needed at release #1, not eventually. The compliance suite is not a future port — it exists today as a Go module at `compliance/cli/` whose version is a source const (`const SuiteVersion`) plus a hand-curated [`compliance/CHANGELOG.md`](../compliance/CHANGELOG.md). Per [ADR 0011](0011-compliance-suite-tooling.md) it ships as a **versioned binary**, not a registry artifact. So a release must stamp and emit two ecosystems at one version:

- the **npm** packages under `typescript/packages/` — a real registry publish; and
- the **Go compliance suite** — a source-const bump + CHANGELOG cut + git tag + a cross-compiled binary attached to a GitHub Release.

## Decision

**A single writer stamps the version; CI on a pushed tag performs the publish; a lockstep guard refuses any drift.**

1. **One source of truth, one writer.** [`scripts/release/stamp-version.mjs`](../scripts/release/stamp-version.mjs) takes `X.Y.Z` and stamps it into (a) the Go `SuiteVersion` const, (b) the matching `## [Unreleased — X.Y.Z]` heading in the compliance CHANGELOG, and (c) every `@postel/*` `package.json`. Because one process writes all three from one input, the npm packages and the Go suite cannot drift in `MAJOR.MINOR`. Its `--check` mode is the CI **lockstep guard**.

2. **mise orchestrates; nothing publishes locally.** `release:prepare <v>` stamps and runs the full `release:gate` (TS quality + spec drift + Go suite tests + receiver **and** sender compliance). `release:tag <v>` creates `vX.Y.Z` and the Go-submodule-compatible `compliance/cli/vX.Y.Z` at the same commit. Pushing those tags is the only act that triggers publishing.

3. **Publish is CI-gated on the tag** ([`.github/workflows/release.yml`](../.github/workflows/release.yml)), honoring AGENTS.md "never publish from a working tree." The workflow re-runs the gate, asserts the lockstep guard against the tag, then `pnpm publish -r` (private packages skip themselves) with npm **provenance**, cross-compiles the runner, and creates the GitHub Release. Pre-release tags (`vX.Y.Z-alpha.0`) publish under the `next` dist-tag and are marked prerelease.

4. **First-release publishable set is deliberately narrow.** Only packages with real code publish: `@postel/core`, `@postel/hono`, `@postel/standalone-pg`, `@postel/standalone-sqlite`. The 12 scaffold packages in the spec's package map are marked `"private": true` until they have code — pre-1.0's `0.x` experimental clause (VISION.md §8) permits shipping a subset. Un-privating a package is the act that adds it to the train.

5. **No release framework yet.** Changesets and release-please are both deferred. This is the same "defer until it earns its keep" call [ADR 0009](0009-compliance-suite-evolution.md) made for compliance-suite runway versioning — revisit when a second independently-maintained port lands and PR-driven automation pays off.

## Alternatives considered

- **Changesets.** The default for TS monorepos, but it versions npm packages only — the Go suite is invisible to it. Lockstep would require a private version-carrier package plus a script syncing its version into the Go const: two sources of truth reconciled by glue. Its headline feature (authored per-PR changelogs) is largely redundant here — OpenSpec change history is already the canonical record (VISION.md §8) and the compliance CHANGELOG is hand-curated. Weakest fit for *this* constraint.

- **release-please with `linked-versions` (node-workspace + go components).** The natural polyglot fit: it natively versions a Go module and npm packages in lockstep, fed by the Conventional Commits this repo already mandates. Deferred, not rejected — it is the most likely successor once releases are frequent enough to want a PR-driven train. Today, coordinating one language port + the suite, the hand-rolled mise flow is less machinery and easier to reason about.

- **Per-language native tooling with no coordination layer.** Rejected: it cannot enforce the `MAJOR.MINOR` lockstep that VISION.md §8 makes CONTRACT.

## Consequences

- The lockstep invariant is enforced mechanically (the guard) rather than by convention.
- The release operation is two `mise run` commands plus a tag push; a human stays in the loop at the push.
- When the second port or a faster cadence arrives, migrating to release-please means expressing this same lockstep in its config — the guard script remains a useful belt-and-braces check regardless.
- This flow is operational tooling, not a capability behavior, so it lives here as an ADR; it does not alter any `openspec/specs/<cap>/spec.md`.
