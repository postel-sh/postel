# 0009 — Compliance suite evolution policy

- **Status**: **Deferred** (lockstep adopted at v0.1.0; revisit when multiple independently-maintained ports exist)
- **Date**: 2026-05-13 (Proposed), 2026-05-14 (Deferred)
- **Decision drivers**: cross-port adoption ergonomics, sustainable suite growth, avoiding the one-way-ratchet failure mode, breaking-change discipline — weighed against operational overhead at the project's current scale (1 port, no code yet)

## Status note

This ADR sketched a runway-based evolution policy for `@postel/compliance` — ADVISORY → MANDATORY → DEPRECATED → removed with documented runway windows. At the v0.1.0 scope decision (OpenSpec change `define-compliance-suite-v01-scope`, 2026-05-14), we **deferred** that model in favor of **lockstep versioning**: `@postel/compliance` shares `MAJOR.MINOR` with the rest of the `@postel/*` release train, every test is required at the version it ships, breaking modifications and removals go via MAJOR like any other `@postel/*` breaking change.

**Why deferred, not rejected**: the runway model is genuinely valuable, but only once multiple ports with independent maintainer cadences exist. At today's scale — TS port-in-progress, no Postel code yet, pre-1.0 experimental-semantics regime already in effect per [VISION.md §8](../VISION.md) — the runway adds bookkeeping overhead without a corresponding "protect ports from breakage" payoff. Lockstep is the simpler operational model and is the right starting point.

**When to revisit**: when the second port (likely the Go receiver per [ADR 0005](0005-polyglot-staged-rollout.md)) lands with its own release cadence — particularly if it's community-maintained rather than maintained by the core team. At that point, lockstep starts to bite: either the slowest port blocks the whole release train, or we break lockstep and need a real runway model. This ADR is the starting point for that conversation.

The lockstep policy itself is in [`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md) (requirement: "Lockstep versioning across `@postel/*` packages").

## Context (preserved from Proposed)

[ADR 0008](0008-conformance-levels.md) makes the compliance suite (`@postel/compliance`) the executable boundary of CONTRACT — what the suite tests is what every port must satisfy. That choice has a downstream consequence: **the suite's evolution becomes the project's most consequential governance surface.**

Naive SemVer applied to the suite isn't enough. Standard SemVer treats "added test" as a MINOR-version feature (additive, non-breaking). But functionally, every new mandatory test is a behavior requirement every port must now satisfy — which IS a breaking event from the port's perspective. Without explicit policy:

- New tests accrete forever. Every test ever added is locked in. The suite becomes a one-way ratchet.
- Ports anchor against an ever-growing bar. Onboarding a new port (or upgrading an existing one) becomes increasingly expensive.
- Breaking changes — removing or modifying tests — become operationally impossible because nobody has a runway.
- The "frozen too early" risk that external review flagged becomes structural.

The runway model below was designed to address those failure modes by distinguishing additions / modifications / removals and giving ports a runway to adapt. The lockstep model we adopted at v0.1.0 sidesteps these failure modes a different way: by coupling all `@postel/*` versions tightly, every port is forced to move together, and the `0.x` experimental-semantics regime absorbs the breakage that would otherwise require a runway. That's sufficient at our scale; it stops being sufficient when ports start moving on independent cadences.

## Working sketch of the deferred runway policy

The remainder of this ADR documents the runway-based model as proposed on 2026-05-13. It is **not the operational policy today** — it's preserved for the future revisit. Anyone proposing to reactivate this model should read it, refine based on real port-maintainer experience, and land it as a new OpenSpec change that supersedes the current lockstep requirement.

### Versioning

`@postel/compliance` follows SemVer: `1.0.0`, `1.1.0`, `2.0.0`. The version is published with each release; ports MUST pin against a specific MINOR (`@1.5.x`, not `@1.x`).

### Test addition (the common case)

1. A spec change adds a new CONTRACT requirement (per [ADR 0008](0008-conformance-levels.md)).
2. The corresponding test lands in the suite's next MINOR release as **ADVISORY**: opt-in via a flag (`--advisory` or similar). Default-off. Ports that don't opt in still pass against the new MINOR.
3. After a documented **runway window** (initial sketch: 6 weeks), the next MINOR makes the test MANDATORY (default-on). Ports failing the test against this new MINOR are no longer conformant against that version.
4. Ports bump their pin when they're ready (or when they've adapted to the new test). Bumping is an explicit PR choice, reviewed against the changelog.

### Test removal

1. Mark the test as **DEPRECATED** in a MINOR release. It still runs, but its result no longer counts toward "must-pass."
2. After a documented runway (initial sketch: 6 months), the next MAJOR removes the test.
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

### Suite changelog

Every test addition, modification, or removal is recorded in a structured changelog at `compliance/CHANGELOG.md`. Each entry references the OpenSpec change, the capability + requirement, the lifecycle stage, and the runway timeline.

### Atomic test ↔ requirement mapping

Each test corresponds to exactly one CONTRACT requirement in a capability spec. The OpenSpec change that introduces the requirement is the natural unit of work; the test addition lands in the same change.

### Port pinning + adoption

- Ports MUST pin against a specific MINOR (`@postel/compliance@^1.5.0`, not `^1.0.0`).
- Bumping the pin is an explicit PR with the changelog diff cited.
- The pin is itself an artifact: it tells external consumers which version of "conformant" a given port version implements.

## Open questions to resolve when revisiting

These remain unresolved and are what real operational experience after multi-port arrival will inform:

- **Exact runway durations.** 6 weeks for test mandatorying / 6 months for test removal were guesses. Realistic numbers depend on how many ports exist and their maintainer capacity.
- **Parallel MAJOR support.** Do we ship security backports to N–1 majors? For how long?
- **Runway communication surface.** Where do port maintainers see "what's about to become mandatory"? `compliance/CHANGELOG.md` + a CLI mode for "what's advisory for my pinned version."
- **Draft tests.** Should there be a `compliance/vectors/draft/` for tests in development before formal landing? Probably yes — gives port maintainers advance notice.
- **Suite organization.** By capability? By requirement title? By category (signing, dedup, retry, fanout)?
- **Test discovery API.** "What tests are advisory vs mandatory for `@1.5.0`?" The CLI must answer this in machine-readable JSON.
- **Migration tests vs behavioral tests.** Some tests verify migrations between suite versions. Treat separately?
- **Suite-as-code vs suite-as-data.** Already resolved at v0.1.0: vectors are language-agnostic JSON; runners are per-language code. The split is preserved under lockstep.
- **Versioning of the runner separately from the test corpus.** Possibly two artifacts: `@postel/compliance-vectors@N` (the test data) and `@postel/compliance@M` (the TypeScript runner).
- **Profile-based conformance** (e.g., "receiver profile" vs "sender profile"). Useful when ports ship asymmetrically (receiver-first). Worth considering when sender-side tests land — relevant under either model.

## How this evolves

1. **Current state**: lockstep at v0.1.0. The compliance spec encodes it; this ADR is Deferred.
2. **Trigger to revisit**: second port lands with independent release cadence (likely Go receiver per [ADR 0005](0005-polyglot-staged-rollout.md)).
3. **Form of revisit**: a new OpenSpec change replaces the "Lockstep versioning across `@postel/*` packages" requirement with a runway-based equivalent; this ADR is promoted from Deferred to Accepted (and refined based on operational experience between v0.1.0 and that moment).

## Alternatives considered

- **Strict SemVer with no runway.** Adding a test = patch bump; nothing's ever mandatory until major. Pushes too much break risk into MAJOR bumps; ports get surprised at upgrade time. Rejected.
- **No versioning** (always pin against HEAD). Operationally cheap until the first time a port breaks unexpectedly; then it's catastrophic. Rejected.
- **Per-test versioning.** Each test has its own "stable since" version. More granular but explosion in metadata complexity. Maintain via convention only. Rejected as primary mechanism (but the changelog ends up encoding per-test history regardless).
- **Profile-based conformance** (e.g., "Postel 1.x receiver profile" vs "Postel 1.x sender profile"). Useful when ports ship asymmetrically (receiver-first, which v0.1.0 effectively is). Worth considering as an extension when the second port lands, regardless of which evolution model is active. Defer.
- **Lockstep across `@postel/*` packages (the model adopted at v0.1.0)**. Operationally simple, sufficient at single-port scale, leverages the existing "all `@postel/*` share MAJOR and release together" rule from VISION §8 one notch tighter (share MINOR too). Drawback: stops scaling cleanly when ports have independent maintainers. Accepted now; this ADR's runway model is the planned successor when that drawback bites.

## Relationship to other ADRs

- [ADR 0005 — Polyglot staged rollout](0005-polyglot-staged-rollout.md): every port must pass `@postel/compliance`. This ADR governs how that bar evolves when lockstep stops being sufficient.
- [ADR 0007 — Storage strategy](0007-storage-strategy.md): each storage adapter must pass `@postel/compliance` (same suite, run against the adapter's HTTP boundary). The adapter matrix doesn't fork the compliance bar.
- [ADR 0008 — Conformance levels](0008-conformance-levels.md): defines the CONTRACT vs PORT-SPECIFIC distinction. The lockstep and runway models are alternative operational mechanics for governing CONTRACT evolution; the distinction itself is upstream of both.
