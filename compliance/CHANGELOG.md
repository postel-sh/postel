# Compliance suite changelog

All notable changes to the `@postel/compliance` test corpus and runner are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The suite ships **lockstep** with the rest of the `@postel/*` release train per [`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md): the suite at version `X.Y.Z` is the test corpus every `@postel/*` port at version `X.Y.Z` MUST pass. The suite's distribution channel (npm package, container image, binary release, source build at a tagged commit) is open and a PORT-SPECIFIC choice; only the version coordination is CONTRACT. Pre-1.0 we live under the `0.x` experimental-semantics regime ([VISION.md §8](../VISION.md)); behavior-changing MINORs are allowed and ports adapt alongside the bump.

## Entry shape

Every test addition, modification, or removal lands here. Each entry cites:

- The OpenSpec change that motivated it (`change/<name>`).
- The capability + `### Requirement: <title>` it covers.
- The release version (`X.Y.Z`) the change ships in.
- For modifications and removals: whether the change is breaking (gates on MAJOR).

## [Unreleased]

> **Planned scope for `0.1.0`** — defined by the `compliance` capability spec ([`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md), requirement *"v0.1.0 initial test scope"*). The lists below mirror the spec; if they ever diverge, the spec wins and this section is the bug to fix.

### Contracts covered (11 CONTRACT requirements)

- `standard-webhooks-compliance` — Compliant headers, signatures, payload structure, and prefixes by default
- `standard-webhooks-compliance` — JWKS discovery extension
- `receiver` — Verify returns parsed event or structured error
- `receiver` — Framework adapters preserve raw bytes
- `receiver` — Multi-secret window
- `receiver` — Timestamp window enforcement
- `receiver` — JWKS consumer
- `receiver` — Replay-attack window enforcement
- `receiver` — Idempotency dedup helper *(HTTP-observable scenarios only; the "Redis is opt-in only" scenario is a packaging assertion, structurally untestable by the suite)*
- `key-management` — JWKS endpoint mounter
- `key-management` — JWKS publishes only public keys

### Vectors (~33 across 8 sub-categories)

Implementation-level expansion of the contracts. Each vector lands via its own PR; each PR appends its rows here before the `0.1.0` cut.

- `wire-format/headers/*` (5 vectors)
- `signature-v1/*` (8 vectors — HMAC matrix)
- `signature-v1a/*` (8 vectors — Ed25519 matrix)
- `receiver/multi-secret/*` (2 vectors)
- `receiver/timestamp-window/*` (2 vectors)
- `receiver/raw-bytes/*` (2 vectors)
- `jwks/*` (3 vectors)
- `receiver/dedup/*` (3 vectors)

### Structurally untestable through the suite (excluded permanently, gated elsewhere)

CONTRACT in capability specs but never enter the suite — they're enforced by other CI checks:

- `receiver` — Edge bundle size budget (bundle-size CI)
- `receiver` — Edge runtime portability (CI deploy test)
- `receiver` — Constant-time signature comparison (timing analysis)
- `receiver` — Verify latency budgets (perf benchmark harness)
- `receiver` — No payload contents in logs (internal observable)
- `receiver` — Test fixtures for signed payloads (library API surface)
- `key-management` — Symmetric secret generation, Asymmetric keypair generation, Endpoint holds a priority-ordered secret array, Rotation API with overlap window (API side), Encryption at rest with KMS adapter, Ephemeral keys via auto-rotation (API side)

### Deferred to later MINOR / MAJOR releases

All sender-side capabilities (sender, retry-policy, replay-reconciliation, endpoint-management state machine, filtering-transformation, storage-layer worker lease, multi-tenancy, observability), plus the receiver-side items pushed out for scoping reasons:

- `standard-webhooks-compliance` — Wraps the official signing library (upstream-vector interop; easy v0.2.0 candidate)
- `standard-webhooks-compliance` — Versioning extension (`webhook-version` header)
- `standard-webhooks-compliance` — IETF-alignment compatibility mode
- `key-management` — Ephemeral keys via auto-rotation full coverage
