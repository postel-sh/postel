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

Implementation-level expansion of the contracts. Each vector lands via its own PR; each PR appends its rows here before the `0.1.0` cut. Vectors checked off below are committed under `compliance/vectors/` already.

- [x] `wire-format/headers/*` (5 vectors) — landed under `compliance/vectors/wire-format/headers/`; covers `standard-webhooks-compliance` "Compliant headers, signatures, payload structure, and prefixes by default". Files: `all-present-accept`, `missing-id-reject`, `missing-timestamp-reject`, `missing-signature-reject`, `malformed-signature-reject`.
- [x] `signature-v1/*` (7 of 8 vectors — HMAC matrix) — landed under `compliance/vectors/signature-v1/`; covers `standard-webhooks-compliance` "Compliant headers, signatures, payload structure, and prefixes by default", `receiver` "Verify returns parsed event or structured error", `receiver` "Timestamp window enforcement", and `receiver` "Replay-attack window enforcement". Files: `valid`, `tampered-body`, `missing-signature`, `wrong-key`, `future-timestamp`, `past-timestamp`, `replay-outside-window`. Also lands `_keys/hmac_alt.yaml` (32 bytes 0xef, for-test-only) — the second HMAC fixture the `wrong-key` and multi-secret vectors share. **Deferred**: `replay-within-window` — needs a dedup-verdict HTTP convention (current `expected.error_code` enum is the receiver's verify-error vocabulary; dedup detection happens after verify and has no error code yet). Lands with the dedup cluster once the convention is specced via OpenSpec.
- [x] `signature-v1a/*` (7 of 8 vectors — Ed25519 matrix) — landed under `compliance/vectors/signature-v1a/`; covers the same four CONTRACT requirements as the v1 cluster but for the asymmetric scheme. Files: `valid`, `tampered-body`, `missing-signature`, `wrong-key`, `future-timestamp`, `past-timestamp`, `replay-outside-window`. Also lands `_keys/ed25519_b.yaml` (seed 32×0x12, for-test-only) — the second asymmetric fixture the `wrong-key` vector signs with. **Deferred**: `replay-within-window` for the same reason as v1 — needs the dedup-verdict HTTP convention to ship alongside the dedup cluster.
- [x] `receiver/multi-secret/*` (2 vectors) — landed under `compliance/vectors/receiver/multi-secret/`; covers `receiver` "Multi-secret window". Files: `old-secret-accept`, `expired-secret-reject`. Also lands `_keys/hmac_secondary.yaml` (32 bytes 0x56, for-test-only) — the verifying-secondary slot in the receiver's rotation array. **Receiver-config note**: these vectors assume the receiver is configured with `[primary=hmac_primary, verifying=hmac_secondary]`. The same config keeps `signature-v1/wrong-key` (signed with `hmac_alt`, foreign) and `signature-v1a/wrong-key` (signed with `ed25519_b`, foreign) valid — no fixture used by an `accept` vector overlaps with a fixture used by a `reject` vector under this config.
- [x] `receiver/timestamp-window/*` (2 vectors) — landed under `compliance/vectors/receiver/timestamp-window/`; covers `receiver` "Timestamp window enforcement". Files: `within-default-accept`, `outside-default-reject`. Isolates the timestamp-window code path from the signing matrix in `signature-v1/{future,past}-timestamp` — both signatures are computed against `hmac_primary` so rejection is unambiguously attributable to the window check.
- [ ] `receiver/raw-bytes/*` (2 vectors)
- [ ] `jwks/*` (3 vectors)
- [ ] `receiver/dedup/*` (3 vectors)

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
