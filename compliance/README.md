# @postel/compliance

The `@postel/compliance` suite is the **behavioral oracle** for Postel: the executable boundary between what every port must do (CONTRACT) and what each port is free to choose (PORT-SPECIFIC). It is the gate every port — TypeScript today, Go / Python / Rust tomorrow — passes to claim Standard Webhooks compliance.

## Role

- **Vendor-neutral.** Drives any HTTP receiver that claims Standard Webhooks compliance, not just Postel's own.
- **Cross-port.** Language-agnostic JSON vectors + per-language runner. The TypeScript runner ships first; future runners reuse the same vectors verbatim.
- **Source of truth.** What the suite tests is CONTRACT. What it doesn't is PORT-SPECIFIC — regardless of what the prose specs imply. See [ADR 0008](../decisions/0008-conformance-levels.md).

## Layout

```
compliance/
├── README.md       <-- you are here
├── CHANGELOG.md    <-- structured changelog of test additions / lifecycle transitions / removals
└── vectors/        <-- (added when the first vectors land) language-agnostic test data, organized by capability / sub-category
```

Per-language runners live alongside their port:

```
typescript/packages/compliance/    <-- the TS runner, published as @postel/compliance
go/compliance/                     <-- future Go runner
python/postel_compliance/          <-- future Python runner
```

All runners consume `compliance/vectors/` without forking the corpus.

## Versioning & runway

The suite follows SemVer. Tests land **ADVISORY** in a MINOR release (opt-in via `--advisory`), become **MANDATORY** in a subsequent MINOR after a documented runway window, may be **DEPRECATED** in a later MINOR, and are removed only in a MAJOR. Breaking modifications of MANDATORY tests gate on MAJOR. Ports MUST pin against a specific MINOR (`@postel/compliance@~0.1.0`).

The full policy, with testable scenarios, is in [`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md). The motivating ADR is [decisions/0009](../decisions/0009-compliance-suite-evolution.md).

## v0.1.0 scope

v0.1.0 ships receiver-side conformance only:

- Wire-format headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`, malformed-signature rejection).
- Signature v1 (HMAC) — valid / tampered / missing / wrong-key / future-ts / past-ts / replay-within-window / replay-outside-window.
- Signature v1a (Ed25519) — same matrix.
- Multi-secret rotation window.
- Timestamp window enforcement (default 5 min and configurable).
- Raw-bytes preservation (JSON re-serialization detection).
- JWKS basics: `kid` lookup, rotation respecting `not_after`, public-key-only enforcement.
- Dedup atomicity (concurrent calls).

Sender-side tests (retry, replay, lease, fanout, outbox semantics, endpoint state machine) are **explicitly out of v0.1.0**. They require sender code to drive against, which doesn't exist yet. Deferred to subsequent MINOR / MAJOR releases.

The exhaustive enumeration of v0.1.0 mandatory vectors is in the capability spec.

## CLI

Once the TS runner ships, the CLI shape is:

```bash
npx @postel/compliance --target https://your-receiver.example.com/webhooks \
                       [--format json|tap|junit] \
                       [--advisory]
```

- `--target` — REQUIRED. The receiver URL.
- `--format` — OPTIONAL. Default is human-readable text. JSON output is consumed by port CIs to plan ADVISORY → MANDATORY adoption.
- `--advisory` — OPTIONAL. Opt into running ADVISORY tests; their results don't affect exit code.

Per the capability spec, the **flag set + semantics** are CONTRACT (cross-port); the **invocation mechanism** (`npx` vs `go run` vs `python -m`) is PORT-SPECIFIC.

## Pointer

The authoritative, machine-checkable contract is [`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md). If anything here disagrees with that spec, the spec wins.
