# @postel/compliance

The `@postel/compliance` suite is the **behavioral oracle** for Postel: the executable boundary between what every port must do (CONTRACT) and what each port is free to choose (PORT-SPECIFIC). It is the gate every port — TypeScript today, Go / Python / Rust tomorrow — passes to claim Standard Webhooks compliance at a given release.

## Role

- **Vendor-neutral.** Drives any HTTP receiver that claims Standard Webhooks compliance, not just Postel's own.
- **Language-agnostic vectors + open-language runner.** The test corpus is JSON; the runner's implementation language is an open choice (recorded by the PR that introduces it).
- **Source of truth.** What the suite tests is CONTRACT. What it doesn't is PORT-SPECIFIC — regardless of what the prose specs imply. See [ADR 0008](../decisions/0008-conformance-levels.md).

## Layout

```
compliance/
├── README.md       <-- you are here
├── CHANGELOG.md    <-- structured changelog of test additions / modifications / removals per release
├── vectors/        <-- (added when the first vectors land) language-agnostic JSON test data
│   ├── _keys/      <-- test-only key fixtures (never used in production code paths)
│   ├── wire-format/
│   ├── signature-v1/
│   ├── signature-v1a/
│   ├── receiver/
│   └── jwks/
└── <runner>/       <-- runner source (the directory name and implementation language are an open choice
                       made by the PR that introduces the first runner)
```

The runner is **not tied to TypeScript** — nothing in the spec assumes a specific implementation language, distribution channel, or invocation mechanism. It MAY end up as a Node-published npm package, a Go binary, a Rust crate, a Python module, or anything else; whatever is chosen, the source lives here at top level.

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

**Suite-untestable** (CONTRACT but gated by other CI checks, never enter the suite): bundle-size budget, edge-runtime portability, constant-time signature comparison, latency budgets, payload-logging defaults, library-API surfaces (key generation, encryption-at-rest), test fixtures.

The exhaustive enumerations live in [`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md).

## CLI

Once the runner ships, the CLI flag surface is fixed cross-port (the invocation mechanism is the runner's choice):

```bash
# Generic shape — actual invocation depends on the runner's implementation language
<runner-cli> --target https://your-receiver.example.com/webhooks \
             [--format json|tap|junit] \
             [--now <ISO8601>]
```

- `--target` — REQUIRED. The receiver URL.
- `--format` — OPTIONAL. Default is human-readable text. JSON is consumed by port CIs and is the source of truth for "what tests does this suite version run."
- `--now` — OPTIONAL. Baseline timestamp for resolving `{{now±<duration>}}` templates in vectors. Default: process wall-clock at run start. Pinning `--now` in CI makes time-sensitive vectors fully reproducible.

Per the capability spec, the **flag set + semantics + exit-code rules + output formats** are CONTRACT. The **invocation mechanism**, **CLI command name**, and **distribution channel** are PORT-SPECIFIC.

## Pointer

The authoritative, machine-checkable contract is [`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md). If anything here disagrees with that spec, the spec wins.
