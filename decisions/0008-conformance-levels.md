# 0008 — Conformance levels: NORMATIVE vs IMPLEMENTATION-DEFINED

- **Status**: Accepted
- **Date**: 2026-05-13
- **Decision drivers**: cross-port contract clarity, port-author ergonomics, maintainability of the compliance contract, prevention of premature standardization on algorithmic details

## Context

The 13 capability specs together carry 115 `### Requirement` blocks. As authored, every one uses SHALL / MUST language — implying that every requirement is part of the cross-port contract. That implication is wrong, and pretending otherwise creates two coupled problems:

1. **Over-strict for ports.** If "round-robin scheduler" is normative, the Go port can't use weighted-fair queueing; the Python port can't use asyncio's natural scheduler. We end up forcing every port into a TS-shaped implementation.
2. **Premature standardization.** Once a behavior is part of the contract, removing or changing it is breaking. If we accidentally lock in algorithm details — polling cadences, lease renewal strategies, HTTP client choices, memory caches — operational lessons learned at scale can't be incorporated without coordinated breaking changes.

External review surfaced this risk explicitly. The fix is to distinguish, per requirement, what's part of the cross-port contract from what's reference-implementation guidance.

## Decision

Every `### Requirement` in `openspec/specs/<cap>/spec.md` carries one of two **conformance levels**:

### NORMATIVE (default)

Part of the cross-port contract. Every conformant port — TypeScript today, Go / Python / Rust tomorrow — MUST satisfy this requirement. The compliance test suite (`@postel/compliance`) MUST have at least one test covering it. Changes to NORMATIVE requirements are governed by [ADR 0009 — Compliance suite evolution policy](0009-compliance-suite-evolution.md) (Proposed).

### IMPLEMENTATION-DEFINED

Guidance / reference-implementation choice. Ports MAY vary the mechanism as long as the visible OUTCOMES remain consistent with related NORMATIVE requirements. The compliance suite does NOT test these directly. Changes to IMPLEMENTATION-DEFINED requirements are patch-level and don't propagate to ports.

**The compliance suite is the executable boundary.** What it tests = normative. What it doesn't = implementation-defined, regardless of how the spec's prose phrases it. When the suite and the prose disagree, the suite wins for cross-port contract purposes.

## Marking convention

Inline tag at the end of the requirement title:

```markdown
### Requirement: Worker fairness across tenants [IMPLEMENTATION-DEFINED]

The library SHALL ensure that no tenant can starve another's deliveries
under burst conditions. The TS reference implementation uses round-robin;
other ports MAY use weighted-fair queueing or any equivalent scheme
satisfying the no-starvation outcome.

#### Scenario: ...
```

```markdown
### Requirement: Endpoint state machine with audit trail

[no tag — defaults to NORMATIVE]
```

Default is NORMATIVE — you must explicitly opt out. This default is deliberate: under-tagging produces a stricter contract (safe but constraining), over-tagging produces a looser one (operationally risky). We'd rather discover excess strictness from port-author complaints than discover excess looseness from production drift.

## What lives where

### Examples of NORMATIVE requirements (kept as-is)

These describe externally observable behavior that the compliance suite must verify:

- Wire-format headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`).
- Signature schemes (`v1` HMAC, `v1a` Ed25519); constant-time comparison.
- Endpoint state vocabulary (`active | disabled | circuit-open`).
- `attempts.status` enum values (kebab-case canonical set).
- Outbox transactional semantics — host-transaction passthrough.
- Idempotency dedup atomicity (concurrent calls; exactly one returns `duplicate: false`).
- Replay safety contract — explicit `freshWebhookId` choice required.
- JWKS shape (`kid`, `alg`, `not_after`, public-only).
- At-least-once delivery guarantee.
- The `Storage` interface operation set (the contract every adapter implements).

### Examples of IMPLEMENTATION-DEFINED requirements (need annotation)

These describe mechanism / algorithm where ports should be free to vary:

- **Worker fairness scheduler algorithm** — round-robin is one choice; weighted-fair queueing is another. Outcome (no starvation) is normative; algorithm isn't.
- **Lease renewal cadence within the lease window** — the FACT that workers MAY renew is normative; how often / on what trigger isn't.
- **Polling interval default for SQLite-style adapters** — polling-as-fallback is normative; cadence default is implementation-defined.
- **Concurrency model** — TS uses async workers, Go will use goroutines, Python could use asyncio or threads. Nothing observable depends on which.
- **HTTP client choice** — `fetch`, `undici`, native `net/http`, `httpx`. Wire output matters; mechanism doesn't.
- **Memory / cache strategies** — JWKS cache eviction, secret-array layout, in-memory dedup TTL backing.

### Borderline cases (handled by per-requirement judgment)

- **Default retry schedule** (`[5s, 5min, 30min, 2h, …]`) — the FACT that a default exists is normative; the specific durations could be either. Recommend: NORMATIVE (specific defaults are part of how Postel is identifiable; changing them is breaking).
- **Auto-disable default threshold** (`100% failures, ≥50 attempts in 24h`) — same shape. Recommend: NORMATIVE for the structure (a minimum-attempt floor MUST exist); IMPLEMENTATION-DEFINED for the exact numbers? Or fully normative? Defer judgment to the port-author conversation.
- **Performance budgets** (`send()` ≤ 5ms p99, throughput ≥ 10k/sec) — these are commitments to users, not to ports. Recommend: NORMATIVE for the first-party implementation; advisory for ports (a Go port may hit different numbers and still be conformant).

## Consequences

- **Existing capability specs need a tagging pass.** Approximately 8–12 requirements across `multi-tenancy`, `storage-layer`, `retry-policy`, and `sender` need explicit `[IMPLEMENTATION-DEFINED]` tags. Lands as an OpenSpec change after this ADR is accepted.
- **AGENTS.md gains workflow rule #7**: "Tag every new requirement with its conformance level (default NORMATIVE); IMPLEMENTATION-DEFINED requires a brief justification."
- **Compliance suite design** is now constrained: every NORMATIVE requirement must map to at least one test. A future CI lint can enforce this once tests exist.
- **Maintenance becomes legible.** Spec changes can now be classified: loosening (NORMATIVE → IMPLEMENTATION-DEFINED, always safe), tightening (IMPLEMENTATION-DEFINED → NORMATIVE, potentially port-affecting), modification within NORMATIVE (versioned per ADR 0009), modification within IMPLEMENTATION-DEFINED (patch-level).
- **Port authors gain an unambiguous contract.** "Do I have to do exactly what TS does?" has a per-requirement answer.

## Alternatives considered

- **No distinction (status quo).** Simple. Breaks at port time. Rejected.
- **Per-spec marking** (whole capability is normative or not). Too coarse — most capabilities have a mix. Rejected.
- **Compliance-suite-only definition** (whatever the suite tests is normative; specs don't annotate). Works mechanically but loses readability — port authors couldn't tell what's normative without running the suite or grepping test files. We want the conformance level visible at the source. Rejected as the *only* source; adopted as the *authoritative* one when prose and suite disagree.
- **RFC 2119-style four-level taxonomy** (MUST / SHOULD / MAY / OPTIONAL, mapped to conformance buckets). More granular. Overkill at our scale — two levels capture the essential distinction without bikeshedding over the boundary between SHOULD and MAY. Reconsider if the two-level system proves too coarse in practice.

## How this evolves

- When the first compliance test lands, this ADR's "the compliance suite is the executable boundary" claim becomes operationally meaningful. Until then, the annotation is a forward-looking commitment.
- An OpenSpec workflow extension (custom schema field or convention update) may follow to require the conformance tag on every new requirement. The simplest first step is the AGENTS.md workflow rule; the schema extension can come later if review discipline alone proves insufficient.
- [ADR 0009](0009-compliance-suite-evolution.md) governs the operational consequences of this distinction — how NORMATIVE requirements migrate over time, runway policies, suite versioning.
