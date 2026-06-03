# 0014 — Release and versioning flow (version-matched conformance, GitHub-Release-driven)

- **Status**: accepted
- **Date**: 2026-06-02
- **Decision drivers**: the compliance suite leads and ports follow at their own pace (VISION §8 / the `compliance` capability spec); two ecosystems ship on independent cadences (a Go binary + npm packages); single-vendor team at pre-1.0; the repo is mise-orchestrated with Conventional Commits and OpenSpec as the canonical change record; "never publish from a working tree" (AGENTS.md)

## Context

[VISION.md §8](../VISION.md) and the `compliance` capability spec's *"Lockstep versioning with the `@postel/*` release train"* requirement (as revised by OpenSpec change `relax-compliance-lockstep-timing`) define the model this flow implements:

- The **compliance suite is versioned `MAJOR.MINOR`, with no PATCH** (`0.2`, `0.3`, `1.0`). It is the **leading edge**: a new requirement lands in the suite first.
- A **port** is versioned `MAJOR.MINOR.PATCH`. A port at `X.Y.Z` claims conformance by passing `compliance@X.Y`. The `PATCH` is the port's own bugfix line — every `X.Y.Z` for a fixed `X.Y` conforms to the same `compliance@X.Y`.
- **Pre-1.0 release timing is independent per artifact**: the suite's latest version MAY be ahead of any port's. At the **MAJOR boundary** (`1.0`+) the suite and all ports cut the major together.

The compliance suite ships as a versioned binary (ADR 0011), not a registry artifact. So the two release tracks are: a Go binary attached to a GitHub Release, and an npm publish of the `@postel/*` packages.

## Decision

**The GitHub Release is the trigger; its tag is the single source of truth for the version; CI does everything; nothing is committed.**

1. **The tag encodes track + version.** `compliance/vMAJOR.MINOR` releases the suite; `ts/vMAJOR.MINOR.PATCH` releases the TypeScript port. [`.github/workflows/release.yml`](../.github/workflows/release.yml) runs `on: release: [published]` and selects the track by tag prefix.

2. **Versions are injected, never committed.** The repo's `package.json` versions stay at `0.0.0` and the Go `SuiteVersion` default stays `"0.x-dev"`. A `compliance/v0.2` build injects the suite version via `-ldflags "-X main.SuiteVersion=0.2"`; a `ts/v0.2.0` build stamps the npm `package.json`s ephemerally in CI ([`scripts/release/stamp-version.mjs`](../scripts/release/stamp-version.mjs)) right before `pnpm publish`. This sidesteps both the local-prepare step and the "don't push bumps to main" house rule.

3. **The conformance guard replaces version-equality.** A `ts/vX.Y.Z` release derives `X.Y`, asserts the tag `compliance/vX.Y` exists (failing fast otherwise — which mechanically enforces "the suite leads"), checks out that tag's `compliance/` corpus + runner over the working tree, and runs the receiver and sender corpus against the port build. There is no check that "the Go const equals the npm version" — the gate is *behavioral conformance against the matching suite tag*.

4. **The suite carries no PATCH.** The compliance track validates that its tag is `MAJOR.MINOR` (no third component) and refuses otherwise. Suite-side fixes re-publish the same `MAJOR.MINOR` or bump MINOR/MAJOR if warranted.

5. **Narrow first-release package set.** Only packages with real code publish: `@postel/core`, `@postel/hono`, `@postel/pg`, `@postel/sqlite`. The scaffold packages and `@postel/compliance-driver` are `"private": true` until they have code; un-privating a package adds it to the train.

6. **No release framework yet.** Changesets and release-please are deferred. The decoupled, GitHub-Release-driven flow is less machinery while one language port exists; revisit (release-please's per-component `linked-versions` is the natural fit) when a second independently-maintained port lands.

## How a release happens

- **Compliance suite:** draft a GitHub Release with tag `compliance/v0.3` → CI cross-compiles the runner (version via ldflags) and attaches the binaries.
- **TypeScript port:** draft a GitHub Release with tag `ts/v0.2.0` → CI overlays `compliance/v0.2`, runs `mise run release:gate` against it, then stamps npm versions and `pnpm publish`es with provenance. A pre-release tag (`ts/v0.2.0-alpha.0`) publishes under the `next` dist-tag.

No local `prepare`/`stamp`/`tag` step; `mise run release:gate` remains available purely as a local "is my branch green" check.

## Alternatives considered

- **Equality-guarded, single-writer stamping (the prior draft of this ADR).** Forced the suite and npm versions to be identical at all times and committed the bump. Contradicted the suite-leads model the `compliance` spec now mandates; replaced.
- **Changesets / release-please now.** Changesets sees only npm; release-please fits the decoupled per-component model but is premature with one port. Deferred (see point 6).
- **Local `release:prepare` + tag push.** Rejected per the user's preference for a CI/GitHub-Release trigger and to avoid committing version bumps.

## Consequences

- The suite can lead the ports, and ports converge at their own pace — the guard validates each port release against its matching suite tag rather than forcing simultaneous version bumps.
- Releasing is "publish a GitHub Release with the right tag"; everything else is CI.
- The repo never carries real version numbers, which some tools/readers find surprising — the tradeoff for committing nothing.
- The per-MINOR compliance fixtures (the `POSTEL_*` env in `compliance:receiver:ts`) are assumed to match the overlaid corpus; a future MINOR that changes fixtures must carry its env with it.
- This is operational tooling, not a capability behavior, so it lives as an ADR and alters no `openspec/specs/<cap>/spec.md`.
