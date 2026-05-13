# 0009 — Compliance suite evolution policy

- **Status**: Accepted
- **Date**: 2026-05-13
- **Decision drivers**: cross-port adoption ergonomics, sustainable suite growth, avoiding the one-way-ratchet failure mode, breaking-change discipline

## Context

[ADR 0008](0008-conformance-levels.md) makes the compliance suite (`@postel/compliance`) the executable boundary of CONTRACT — what the suite tests is what every port must satisfy. That choice has a downstream consequence: **the suite's evolution becomes the project's most consequential governance surface.**

Naive SemVer applied to the suite isn't enough. Standard SemVer treats "added test" as a MINOR-version feature (additive, non-breaking). But functionally, every new mandatory test is a behavior requirement every port must now satisfy — which IS a breaking event from the port's perspective. Without explicit policy:

- New tests accrete forever. Every test ever added is locked in. The suite becomes a one-way ratchet.
- Ports anchor against an ever-growing bar. Onboarding a new port (or upgrading an existing one) becomes increasingly expensive.
- Breaking changes — removing or modifying tests — become operationally impossible because nobody has a runway.
- The "frozen too early" risk that external review flagged becomes structural.

The fix is a policy that distinguishes test additions / modifications / removals from each other and gives ports a runway to adapt.

## Policy

The authoritative policy lives in [`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md), where each clause is a testable CONTRACT requirement with named scenarios. This ADR captures the rationale; the spec captures the contract.

### Versioning

`@postel/compliance` follows SemVer: `1.0.0`, `1.1.0`, `2.0.0`. Pre-1.0 (`0.x`) lives under the experimental-semantics regime per [VISION.md §8](../VISION.md). The version is published with each release; ports MUST pin against a specific MINOR (`@~0.1.0`, `@~1.5.0`), not `@^0.x` or `@^1`.

### Test addition (the common case)

1. A spec change adds a new CONTRACT requirement (per [ADR 0008](0008-conformance-levels.md)).
2. The corresponding test lands in the suite's next MINOR release as **ADVISORY**: opt-in via `--advisory`. Default-off. Ports that don't opt in still pass against the new MINOR.
3. After the documented **runway window** (at least 6 weeks pre-1.0; post-1.0 cadence revisited when the second port lands), the next MINOR makes the test MANDATORY (default-on). Ports failing the test against this new MINOR are no longer conformant against that version.
4. Ports bump their pin when they're ready (or when they've adapted to the new test). Bumping is an explicit PR choice, reviewed against the changelog.

### Test removal

1. Mark the test as **DEPRECATED** in a MINOR release. It still runs, but its result no longer counts toward "must-pass."
2. After the documented runway (at least 6 months pre-1.0), the next MAJOR removes the test.
3. Removal carries downstream meaning: the corresponding CONTRACT requirement in the capability spec becomes PORT-SPECIFIC (or is removed) in the same release window.

### Test modification

Two flavors:

- **Additive constraint** (the new behavior is a superset of the old; passing the new test implies passing the old): same runway as test addition. Lands ADVISORY in a MINOR; MANDATORY in a subsequent MINOR after the runway.
- **Breaking constraint** (the new behavior is incompatible with the old): MAJOR version bump. The old test is removed in the same MAJOR. Ports must adapt to the new test as part of upgrading to the new MAJOR.

### MAJOR bumps

A MAJOR is published when any of:

- A DEPRECATED test crosses its removal runway.
- A MANDATORY test is modified with a breaking constraint.
- The suite's structure changes incompatibly (test path renames, output-format changes, vector-schema breaking changes).

MAJOR bumps SHOULD be rare. The runway policy is designed so that most changes flow through MINOR releases without forcing MAJOR coordination.

### Suite changelog

Every test addition, modification, or removal is recorded in a structured changelog at `compliance/CHANGELOG.md`. Each entry references:

- The OpenSpec change that motivated it (`change/<name>`).
- The capability + requirement title it covers.
- Its lifecycle stage (ADVISORY introduced, MANDATORY since version X, DEPRECATED since version Y, REMOVED in MAJOR Z).
- The runway timeline (date introduced, date mandatory, date deprecated, date removed).

This changelog is the primary planning surface for port maintainers. The CLI's `--format json` output exposes the same data in a machine-readable form scoped to the suite version being run.

### Atomic test ↔ requirement mapping

Each test corresponds to exactly one CONTRACT requirement in a capability spec. Vectors carry a `requirement` field naming the requirement verbatim. The OpenSpec change that introduces the requirement is the natural unit of work; the test addition lands in the same change. The OpenSpec workflow's `language-impact.md` artifact gains a section: "Compliance suite impact — which new tests, which runway, which removal."

### Port pinning + adoption

- Ports MUST pin against a specific MINOR (`@postel/compliance@~0.1.0`, not `@^0.x` or `@^1.x`).
- Bumping the pin is an explicit PR with the changelog diff cited.
- The pin is itself an artifact: it tells external consumers which version of "conformant" a given port version implements.

### Vectors vs runner

The suite splits into language-agnostic JSON vectors (`compliance/vectors/`) and per-language runners. The TS runner ships first as `@postel/compliance` from `typescript/packages/compliance/`. Future Go / Python / Rust runners consume the same vectors. Vectors are the cross-port asset; runners are per-language and may evolve independently as long as they faithfully exercise the vectors.

## Operational state since v0.1.0

- `@postel/compliance` ships per the v0.1.0 scope enumerated in [`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md) — receiver-side wire-format + signing + JWKS basics + dedup atomicity. Sender-side tests are explicitly deferred.
- `compliance/CHANGELOG.md` is the structured changelog port maintainers track.
- The TS runner exposes `--format json` for machine-readable test discovery, which port CIs use to plan ADVISORY → MANDATORY transitions.
- The vectors-vs-runner split is now in effect: vectors live under `compliance/vectors/`; the TS runner under `typescript/packages/compliance/`.

## Still open after v0.1.0

Genuinely unresolved questions that operational experience after v0.1.0 will inform:

- **Exact post-1.0 runway durations.** Pre-1.0 we pin minimums (6 weeks for MANDATORY promotion, 6 months for removal). The post-1.0 cadence depends on how many ports exist and their maintainer capacity. Revisit when the second port (likely the Go receiver) lands.
- **Parallel MAJOR support.** Do we ship security backports to N–1 majors? For how long? Defer until the suite has a MAJOR history.
- **Draft tests.** A `compliance/vectors/draft/` for tests in development before formal landing — gives port maintainers advance notice. Probably yes; landing this is its own change.
- **Migration tests vs behavioral tests.** Vectors that test migrations between suite versions (`upgrade from 1.4 to 1.5 — what changes?`) have a different lifecycle from behavioral tests. Likely treat separately, but the shape isn't yet pressing.
- **Suite organization at scale.** Today: by capability + sub-category. As vectors multiply, finer-grained organization (sharding, parallel runners, suites-of-suites) may be warranted.

## Closure record

Status was promoted Proposed → Accepted via OpenSpec change [`define-compliance-suite-v01-scope`](../openspec/specs/compliance/spec.md) on 2026-05-13. That change is what created the `compliance` capability spec, established the vectors/runner architecture, and enumerated the v0.1.0 MANDATORY scope. The policy in this ADR is now operationally meaningful: vectors exist, ports pin, runways are real.

## Alternatives considered

- **Strict SemVer with no runway.** Adding a test = patch bump; nothing's ever mandatory until major. Pushes too much break risk into MAJOR bumps; ports get surprised at upgrade time. Rejected.
- **No versioning** (always pin against HEAD). Operationally cheap until the first time a port breaks unexpectedly; then it's catastrophic. Rejected.
- **Per-test versioning.** Each test has its own "stable since" version. More granular but explosion in metadata complexity. Maintain via convention only. Rejected as primary mechanism (but the changelog ends up encoding per-test history regardless).
- **Profile-based conformance** (e.g., "Postel 1.x receiver profile" vs "Postel 1.x sender profile"). Useful when ports ship asymmetrically (receiver-first, which v0.1.0 effectively is). Worth considering as a first-class extension to the SemVer model when sender-side tests land. Defer.

## Relationship to other ADRs

- [ADR 0005 — Polyglot staged rollout](0005-polyglot-staged-rollout.md): every port must pass `@postel/compliance`. This ADR governs how that bar evolves.
- [ADR 0007 — Storage strategy](0007-storage-strategy.md): each storage adapter must pass `@postel/compliance` (same suite, run against the adapter's HTTP boundary). The adapter matrix doesn't fork the compliance bar.
- [ADR 0008 — Conformance levels](0008-conformance-levels.md): defines the CONTRACT vs PORT-SPECIFIC distinction whose operational mechanics this ADR governs.
