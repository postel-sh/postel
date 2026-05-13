# 0009 — Compliance suite evolution policy

- **Status**: **Proposed** (final policy lands when the first compliance test is implemented; this ADR is a sketch authored alongside [ADR 0008](0008-conformance-levels.md) so the operational consequences of "the suite is the contract" aren't undefined)
- **Date**: 2026-05-13
- **Decision drivers**: cross-port adoption ergonomics, sustainable suite growth, avoiding the one-way-ratchet failure mode, breaking-change discipline

> **For the next agent picking this up**: this is a draft. The final policy must be informed by real experience writing and shipping the first batch of compliance tests. Read this cold to understand the working model, then refine based on what actually happens in practice. Promote Status to "Accepted" only after the first 10–20 tests exist and the runway model has been exercised at least once.

## Context

[ADR 0008](0008-conformance-levels.md) makes the compliance suite (`@postel/compliance`) the executable boundary of CONTRACT — what the suite tests is what every port must satisfy. That choice has a downstream consequence: **the suite's evolution becomes the project's most consequential governance surface.**

Naive SemVer applied to the suite isn't enough. Standard SemVer treats "added test" as a MINOR-version feature (additive, non-breaking). But functionally, every new mandatory test is a behavior requirement every port must now satisfy — which IS a breaking event from the port's perspective. Without explicit policy:

- New tests accrete forever. Every test ever added is locked in. The suite becomes a one-way ratchet.
- Ports anchor against an ever-growing bar. Onboarding a new port (or upgrading an existing one) becomes increasingly expensive.
- Breaking changes — removing or modifying tests — become operationally impossible because nobody has a runway.
- The "frozen too early" risk that external review flagged becomes structural.

The fix is a policy that distinguishes test additions / modifications / removals from each other and gives ports a runway to adapt.

## Working sketch of the policy

### Versioning

`@postel/compliance` follows SemVer: `1.0.0`, `1.1.0`, `2.0.0`. The version is published with each release; ports MUST pin against a specific MINOR (`@1.5.x`, not `@1.x`).

### Test addition (the common case)

1. A spec change adds a new CONTRACT requirement (per [ADR 0008](0008-conformance-levels.md)).
2. The corresponding test lands in the suite's next MINOR release as **ADVISORY**: opt-in via a flag (`--advisory` or similar). Default-off. Ports that don't opt in still pass against the new MINOR.
3. After a documented **runway window** (current sketch: 6 weeks), the next MINOR makes the test MANDATORY (default-on). Ports failing the test against this new MINOR are no longer conformant against that version.
4. Ports bump their pin when they're ready (or when they've adapted to the new test). Bumping is an explicit PR choice, reviewed against the changelog.

### Test removal

1. Mark the test as **DEPRECATED** in a MINOR release. It still runs, but its result no longer counts toward "must-pass."
2. After a documented runway (current sketch: 6 months), the next MAJOR removes the test.
3. Removal carries downstream meaning: the corresponding CONTRACT requirement in the capability spec becomes PORT-SPECIFIC (or is removed) in the same release window.

### Test modification

Two flavors:

- **Additive constraint** (the new behavior is a superset of the old; passing the new test implies passing the old): same runway as test addition. Lands ADVISORY in a MINOR; MANDATORY in a subsequent MINOR after the runway.
- **Breaking constraint** (the new behavior is incompatible with the old): MAJOR version bump. The old test is removed in the same MAJOR. Ports must adapt to the new test as part of upgrading to the new MAJOR.

### MAJOR bumps

A MAJOR is published when any of:

- A DEPRECATED test crosses its removal runway.
- A MANDATORY test is modified with a breaking constraint.
- The suite's structure changes incompatibly (test organization, naming, output format).

MAJOR bumps SHOULD be rare. The runway policy is designed so that most changes flow through MINOR releases without forcing MAJOR coordination.

### Suite changelog

Every test addition, modification, or removal is recorded in a structured changelog at `compliance/CHANGELOG.md`. Each entry references:

- The OpenSpec change that motivated it (`change/<name>`).
- The capability + requirement title it covers.
- Its lifecycle stage (ADVISORY introduced, MANDATORY since version X, DEPRECATED since version Y, REMOVED in MAJOR Z).
- The runway timeline (date introduced, date mandatory, date deprecated, date removed).

This changelog is the primary planning surface for port maintainers.

### Atomic test ↔ requirement mapping

Each test corresponds to exactly one CONTRACT requirement in a capability spec. The OpenSpec change that introduces the requirement is the natural unit of work; the test addition lands in the same change. The OpenSpec workflow's `language-impact.md` artifact gains a section: "Compliance suite impact — which new tests, which runway, which removal."

### Port pinning + adoption

- Ports MUST pin against a specific MINOR (`@postel/compliance@^1.5.0`, not `^1.0.0`).
- Bumping the pin is an explicit PR with the changelog diff cited.
- The pin is itself an artifact: it tells external consumers which version of "conformant" a given port version implements.

## Open questions to resolve when the suite lands

Items the sketch hand-waves and that operational experience will inform:

- **Exact runway durations.** 6 weeks for test mandatorying / 6 months for test removal are guesses. Realistic numbers depend on how many ports exist and their maintainer capacity. Probably shorter pre-1.0, longer post-1.0.
- **Parallel MAJOR support.** Do we ship security backports to N–1 majors? For how long? Probably yes-ish but the specifics need test-suite-aged-enough to warrant the conversation.
- **Runway communication.** Where do port maintainers see "what's about to become mandatory"? `compliance/CHANGELOG.md` is the source of truth; we also want a "what's advisory for my pinned version" mode in the suite CLI.
- **Draft tests.** Should there be a `compliance/draft/` for tests in development before formal landing? Probably yes — gives port maintainers advance notice.
- **Suite organization.** By capability? By requirement title? By category (signing, dedup, retry, fanout)? Affects discoverability and test parallelism.
- **Test discovery API.** "What tests are advisory vs mandatory for `@1.5.0`?" The CLI must answer this in a machine-readable way (JSON output) so port CIs can plan automatically.
- **Migration tests vs behavioral tests.** Some tests verify migrations between suite versions (`upgrade from 1.4 to 1.5 — what changes?`). These have different lifecycle from behavioral tests. Treat separately? Probably.
- **Suite-as-code vs suite-as-data.** Are tests TypeScript code, or declarative (YAML/JSON test vectors)? Affects how easily ports in other languages can reuse the same test cases vs needing translation. Strong preference toward declarative-where-possible (test vectors are language-agnostic; the runner is per-language) — but some behavioral assertions need code.
- **Versioning of the runner separately from the test corpus.** Possibly two artifacts: `@postel/compliance-vectors@N` (the test data, language-agnostic) and `@postel/compliance@M` (the TypeScript runner that exercises a target HTTP receiver).

## What this means right now (Proposed-status implications)

While Status is Proposed:

- ADR 0008's claim "the suite is the boundary" is forward-looking. No tests exist; no port pinning happens; no runway is enforced.
- New CONTRACT requirements still get added freely in OpenSpec changes (no test version to be advisory in).
- This ADR's existence is the commitment that **before any test ships, this policy is finalized**. The next agent or contributor implementing the first compliance test reads this draft, refines it based on actual experience, promotes to Accepted, and updates [distribution-packaging](../openspec/specs/distribution-packaging/spec.md) accordingly.

## How to close this ADR

1. Wait for the first batch of compliance tests to be authored alongside the first capability implementation (likely `receiver` for edge-portability validation).
2. Use that authoring experience to refine: runway durations, suite organization, test discovery, vectors-vs-code split.
3. Move Status from Proposed → Accepted; update the "Working sketch" section into a final policy.
4. Add the policy as actual CONTRACT-level requirements in `openspec/specs/distribution-packaging/spec.md` (or wherever the rename to `distribution-packaging-typescript` puts it). The policy itself becomes part of the cross-port contract — it's what port authors rely on when planning their suite-version adoption.
5. Update AGENTS.md's workflow rules so contributors authoring a CONTRACT-requirement change know the test goes in the same PR with the right runway tagging.

## Alternatives considered

- **Strict SemVer with no runway.** Adding a test = patch bump; nothing's ever mandatory until major. Pushes too much break risk into MAJOR bumps; ports get surprised at upgrade time. Rejected.
- **No versioning** (always pin against HEAD). Operationally cheap until the first time a port breaks unexpectedly; then it's catastrophic. Rejected.
- **Per-test versioning.** Each test has its own "stable since" version. More granular but explosion in metadata complexity. Maintain via convention only. Rejected as primary mechanism (but the changelog ends up encoding per-test history regardless).
- **Profile-based conformance** (e.g., "Postel 1.x receiver profile" vs "Postel 1.x sender profile"). Useful when ports ship asymmetrically (receiver-first). Worth considering as an extension to the SemVer model when the second port lands. Defer.

## Relationship to other ADRs

- [ADR 0005 — Polyglot staged rollout](0005-polyglot-staged-rollout.md): every port must pass `@postel/compliance`. This ADR governs how that bar evolves.
- [ADR 0007 — Storage strategy](0007-storage-strategy.md): each storage adapter must pass `@postel/compliance` (same suite, run against the adapter's HTTP boundary). The adapter matrix doesn't fork the compliance bar.
- [ADR 0008 — Conformance levels](0008-conformance-levels.md): defines the CONTRACT vs PORT-SPECIFIC distinction whose operational mechanics this ADR governs.
