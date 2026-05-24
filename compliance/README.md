# @postel/compliance

The `@postel/compliance` suite is the **behavioral oracle** for Postel: the executable boundary between what every port must do (CONTRACT) and what each port is free to choose (PORT-SPECIFIC). It is the gate every port — TypeScript today, Go / Python / Rust tomorrow — passes to claim Standard Webhooks compliance at a given release.

## Role

- **Vendor-neutral.** Drives any HTTP receiver that claims Standard Webhooks compliance, not just Postel's own.
- **Language-agnostic vectors + Go runner.** Test corpus is YAML (safe subset); the runner is implemented in Go and ships as a versioned binary. Per [ADR 0011](../decisions/0011-compliance-suite-tooling.md).
- **Source of truth.** What the suite tests is CONTRACT. What it doesn't is PORT-SPECIFIC — regardless of what the prose specs imply. See [ADR 0008](../decisions/0008-conformance-levels.md).

## Layout

```
compliance/
├── README.md         <-- you are here
├── CHANGELOG.md      <-- structured changelog of test additions / modifications / removals per release
├── vectors/          <-- language-agnostic YAML test data (added as clusters land)
│   ├── _keys/        <-- test-only key fixtures as YAML (never used in production code paths)
│   ├── wire-format/
│   ├── signature-v1/
│   ├── signature-v1a/
│   ├── receiver/
│   └── jwks/
├── schema/           <-- canonical JSON Schema for vector files (used by CI to validate every vector)
└── cli/              <-- Go module + main package; the runner. Builds to a single static binary
                         distributed as a tagged GitHub release asset.
```

The runner is implemented in **Go** per [ADR 0011](../decisions/0011-compliance-suite-tooling.md). The Go choice was driven by single-binary distribution (no Node / Python / Rust runtime required on consumers), stdlib-native HTTP/crypto/YAML/JSON, and cross-compilation for `linux/{amd64,arm64}`, `darwin/{amd64,arm64}`, `windows/amd64`. The compliance spec keeps the language formally open — re-implementing the runner in another language is allowed if it produces identical verdicts on the same vectors.

## Versioning — lockstep with the `@postel/*` release train

The compliance suite (vectors + runner) shares `MAJOR.MINOR` with every `@postel/*` port package, per [VISION.md §8](../VISION.md)'s shared-release-train rule. A port version `X.Y.Z` claims conformance by passing the suite at version `X.Y.*` end-to-end before release. The suite's **distribution channel is open** — npm, container, binary, source build at a tagged commit — what's coordinated is the version, not the package format.

There is no opt-in tier and no graduated runway: every test in the suite at version `X.Y` is required for any `@postel/*` port that ships at `X.Y`. Breaking modifications, test removals, and breaking structural changes follow the same MAJOR-bump rule that governs every `@postel/*` package. Pre-1.0 (`0.x`) lives under the experimental-semantics regime per [VISION.md §8](../VISION.md): MINORs MAY ship behavior-changing tests, and ports adapt alongside the bump.

The runway-based evolution model previously sketched in [ADR 0009](../decisions/0009-compliance-suite-evolution.md) is **Deferred**: revisit once a second independently-maintained port lands. Until then, lockstep is the simpler operational model.

The full versioning rule, with testable scenarios, is in [`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md).

## v0.1.0 scope — receiver-side, by CONTRACT requirement

v0.1.0 covers 11 CONTRACT requirements from `standard-webhooks-compliance`, `receiver`, and `key-management`:

| Capability | Requirement |
|---|---|
| `standard-webhooks-compliance` | Compliant headers, signatures, payload structure, and prefixes by default |
| `standard-webhooks-compliance` | JWKS discovery extension |
| `receiver` | Verify returns parsed event or structured error |
| `receiver` | Framework adapters preserve raw bytes |
| `receiver` | Multi-secret window |
| `receiver` | Timestamp window enforcement |
| `receiver` | JWKS consumer |
| `receiver` | Replay-attack window enforcement |
| `receiver` | Idempotency dedup helper *(HTTP-observable scenarios)* |
| `key-management` | JWKS endpoint mounter |
| `key-management` | JWKS publishes only public keys |

Implementation-level: ~33 vectors across 8 sub-categories — wire-format headers (5), signature v1 HMAC matrix (8), signature v1a Ed25519 matrix (8), multi-secret rotation (2), timestamp window (2), raw-bytes preservation (2), JWKS basics (3), dedup atomicity (3).

**Sender-side tests** (retry, replay, lease, fanout, outbox semantics, endpoint state machine) are **explicitly out of v0.1.0**. They require sender code to drive against, which doesn't exist yet. Deferred to subsequent MINOR / MAJOR releases under the lockstep model.

**Suite-untestable** (CONTRACT but gated by other CI checks, never enter the suite): constant-time signature comparison, latency budgets, payload-logging defaults, library-API surfaces (key generation, encryption-at-rest), test fixtures.

The exhaustive enumerations live in [`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md).

## CLI

The Go runner ships as a single static binary. Once the runner ships (Track A of the v0.1.0 plan), the invocation is:

```bash
# Download per the matching tag: compliance-v0.1.0
curl -sSL https://github.com/postel-sh/postel/releases/download/compliance-v0.1.0/compliance-linux-amd64 \
    -o compliance && chmod +x ./compliance

# Run
./compliance --target https://your-receiver.example.com/webhooks \
             [--format json|tap|junit] \
             [--now <ISO8601>]
```

- `--target` — REQUIRED. The receiver URL.
- `--format` — OPTIONAL. Default is human-readable text. JSON output is consumed by port CIs and is the source of truth for "what tests does this suite version run."
- `--now` — OPTIONAL. Baseline timestamp for resolving `{{now±<duration>}}` templates in vectors. Default: process wall-clock at run start. Pinning `--now` in CI makes time-sensitive vectors fully reproducible.

Per the capability spec, the **flag set + semantics + exit-code rules + output formats** are CONTRACT (cross-port). The **invocation mechanism**, **CLI command name**, and **distribution channel** are PORT-SPECIFIC — if/when a re-implementation in another language ships, it MAY choose different invocation ergonomics so long as it accepts the same flags and exhibits the same behavior.

## Distribution

Per [ADR 0011](../decisions/0011-compliance-suite-tooling.md):

- **Tag**: each suite release tags `compliance-v<X.Y.Z>` on `main`. Separate namespace from the TS `@postel/*` packages, but the `X.Y.Z` is lockstep with them per the compliance capability spec.
- **Assets**: tag triggers cross-compilation to per-OS binaries (`linux/{amd64,arm64}`, `darwin/{amd64,arm64}`, `windows/amd64`) attached as release assets.
- **Consumption**: ports' CIs pull the right asset via `curl + tar + chmod`. No language-specific package manager required.

## Pointer

The authoritative, machine-checkable contract is [`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md). If anything here disagrees with that spec, the spec wins.
