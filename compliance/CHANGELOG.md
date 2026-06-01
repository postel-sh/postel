# Compliance suite changelog

All notable changes to the `@postel/compliance` test corpus and runner are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The suite ships **lockstep** with the rest of the `@postel/*` release train per [`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md): the suite at version `X.Y.Z` is the test corpus every `@postel/*` port at version `X.Y.Z` MUST pass. The suite's distribution channel (npm package, container image, binary release, source build at a tagged commit) is open and a PORT-SPECIFIC choice; only the version coordination is CONTRACT. Pre-1.0 we live under the `0.x` experimental-semantics regime ([VISION.md §8](../VISION.md)); behavior-changing MINORs are allowed and ports adapt alongside the bump.

## Entry shape

Every test addition, modification, or removal lands here. Each entry cites:

- The OpenSpec change that motivated it (`change/<name>`).
- The capability + `### Requirement: <title>` it covers.
- The release version (`X.Y.Z`) the change ships in.
- For modifications and removals: whether the change is breaking (gates on MAJOR).

## [Unreleased — 0.2.0]

> **Planned scope for `0.2.0`** — defined by the `compliance` capability spec ([`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md), requirement *"v0.2.0 sender-side initial test scope"*). This MINOR extends the suite with sender-mode capability via the HTTP control-plane mechanism (see *"Sender-side compliance driver mechanism"*). The vector schema, runner CLI, and two-layer architecture requirements grow to cover sender-mode in a strict-superset way over v0.1.0 (existing receiver-mode vectors remain valid). Lands via OpenSpec change `add-sender-side-compliance-v02`.
>
> ### Schema additions
>
> - Optional `mode: "receiver" | "sender"` discriminator (default `receiver`).
> - Sender-mode fields: `triggers[]`, `mock_receiver{}`, `expected_requests[]`.
> - Expected error-code enum gains `ENDPOINT_VALIDATION`, `SSRF_BLOCKED`, `ENDPOINT_DISABLED` for sender outcomes.
>
> ### CLI additions
>
> - `--sender-control <url>` flag (XOR with `--target`).
> - `--mock-receiver-host` (default `127.0.0.1`).
> - `--mock-receiver-port` (default `0` = ephemeral).
>
> ### v0.2.0 sender vectors
>
> ~28 vectors across 10 sub-categories: `sender/wire-output/*` (4), `sender/idempotency/*` (2), `sender/fanout/*` (3), `sender/ttl/*` (2), `sender/retry-schedule/*` (4), `sender/deadlines/*` (2), `sender/ssrf-tls/*` (3), `sender/dead-letter/*` (2), `sender/filtering/*` (4), `sender/multi-tenancy/*` (2). `sender/filtering/*` covers the two wire-expressible filter shapes — type-glob and channel — each with a match and a no-match vector (`type-filter-glob-match`, `type-filter-glob-no-match`, `channel-filter-match`, `channel-filter-no-match`). The full corpus lands in this change alongside the runner sender-mode framework and the `@postel/compliance-driver` control plane. `sender/late-binding/*` is deferred (it needs a control-plane `update_endpoint` op; the new-endpoint-after-send facet is already covered by `sender/fanout/late-binding-new-endpoint`). The Go runner's sender-mode execution engine — an embedded mock receiver, control-plane driving (reset / register / send / start-workers / advance-clock), and per-vector assertion of `expected_requests` (count, headers, body, Standard Webhooks signature verification, real-time `arrived_within_ms`, and `attempt_status` read back via `GET /control/messages/:id`) — executes all 28 sender vectors end-to-end against the `@postel/compliance-driver`. `mise run compliance:sender:ts` boots the driver and runs the corpus; a missing or mismatched delivery fails the run.
>
> ### Out of scope at v0.2.0 (deferred to v0.3+)
>
> Per the renamed *"Out-of-scope behaviors at the current MINOR"* requirement: full at-least-once crash-reclaim simulation, full per-endpoint circuit breaker state-machine assertions, full auto-disable 24-hour-window assertions, multi-tenancy fairness statistics, advanced observability, full TLS bad-cert matrix, reconciliation, replay-reconciliation chapter. Two `filtering-transformation` CONTRACTs are deferred because they are code-side host callbacks — a transform/predicate is a function, not JSON, so "Transform produces body to send" and "Filter and transform errors fail closed" cannot be expressed over the HTTP control plane until a named-callback registration mechanism is designed; they remain CONTRACT and stay covered by each port's unit suite.

## [0.1.0]

> Receiver-side wire-format and signing behavior corpus. Defined by the `compliance` capability spec requirement *"v0.1.0 initial test scope"*.

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
- [x] `signature-v1/*` (8 of 8 vectors — HMAC matrix) — landed under `compliance/vectors/signature-v1/`; covers `standard-webhooks-compliance` "Compliant headers, signatures, payload structure, and prefixes by default", `receiver` "Verify returns parsed event or structured error", `receiver` "Timestamp window enforcement", `receiver` "Replay-attack window enforcement", and `receiver` "Idempotency dedup helper". Files: `valid`, `tampered-body`, `missing-signature`, `wrong-key`, `future-timestamp`, `past-timestamp`, `replay-outside-window`, `replay-within-window`. Also lands `_keys/hmac_alt.yaml` (32 bytes 0xef, for-test-only) — the second HMAC fixture the `wrong-key` and multi-secret vectors share. (`replay-within-window` shipped alongside the dedup cluster once the duplicate-outcome HTTP convention landed via OpenSpec change `extend-vector-schema-dedup-verdict`.)
- [x] `signature-v1a/*` (8 of 8 vectors — Ed25519 matrix) — landed under `compliance/vectors/signature-v1a/`; covers the same five CONTRACT requirements as the v1 cluster but for the asymmetric scheme. Files: `valid`, `tampered-body`, `missing-signature`, `wrong-key`, `future-timestamp`, `past-timestamp`, `replay-outside-window`, `replay-within-window`. Also lands `_keys/ed25519_b.yaml` (seed 32×0x12, for-test-only).
- [x] `receiver/multi-secret/*` (2 vectors) — landed under `compliance/vectors/receiver/multi-secret/`; covers `receiver` "Multi-secret window". Files: `old-secret-accept`, `expired-secret-reject`. Also lands `_keys/hmac_secondary.yaml` (32 bytes 0x56, for-test-only) — the verifying-secondary slot in the receiver's rotation array. **Receiver-config note**: these vectors assume the receiver is configured with `[primary=hmac_primary, verifying=hmac_secondary]`. The same config keeps `signature-v1/wrong-key` (signed with `hmac_alt`, foreign) and `signature-v1a/wrong-key` (signed with `ed25519_b`, foreign) valid — no fixture used by an `accept` vector overlaps with a fixture used by a `reject` vector under this config.
- [x] `receiver/timestamp-window/*` (2 vectors) — landed under `compliance/vectors/receiver/timestamp-window/`; covers `receiver` "Timestamp window enforcement". Files: `within-default-accept`, `outside-default-reject`. Isolates the timestamp-window code path from the signing matrix in `signature-v1/{future,past}-timestamp` — both signatures are computed against `hmac_primary` so rejection is unambiguously attributable to the window check.
- [x] `receiver/raw-bytes/*` (2 vectors) — landed under `compliance/vectors/receiver/raw-bytes/`; covers `receiver` "Framework adapters preserve raw bytes". Files: `byte-identical-accept` (happy-path round-trip), `json-reserialized-reject` (signature computed against canonical body, request sends whitespace-padded body; conformant receiver rejects with SIGNATURE_INVALID, lenient/re-serializing receiver erroneously accepts and fails the vector).
- [x] `jwks/*` (3 vectors) — landed under `compliance/vectors/jwks/`; covers `receiver` "JWKS consumer" and `key-management` "JWKS publishes only public keys" (and exercises the `standard-webhooks-compliance` "JWKS discovery extension" + `key-management` "JWKS endpoint mounter" pathways end-to-end). Files: `kid-lookup` (Ed25519 verify via kid extracted from webhook-id), `rotation` (kid is rotated out of JWKS; UNKNOWN_KEY_ID), `public-only` (GET /.well-known/webhooks-keys returns 200 — the no-private-key structural assertion is gated out-of-band until the vector schema gains a `response_body_schema` field).
- [x] `receiver/dedup/*` (3 vectors) — landed under `compliance/vectors/receiver/dedup/`; covers `receiver` "Idempotency dedup helper" via the new `expected.outcome: duplicate` shape introduced by OpenSpec change `extend-vector-schema-dedup-verdict`. Files: `first-receipt` (fresh id → accept), `duplicate-receipt` (pre-seeded id → duplicate via `X-Postel-Dedup-Result: duplicate` header), `concurrent-atomicity` (single-request stand-in; the receiver's own unit tests cover atomicity, full concurrent semantics land with the v0.2.0 multi-step vector schema). **Receiver-config note**: the receiver-under-test is documented to pre-seed dedup state for any webhook-id starting with `pre_seen_*` — a runner ↔ receiver test convention reserved for compliance setup and not used by real delivery traffic.

### Structurally untestable through the suite (excluded permanently, gated elsewhere)

CONTRACT in capability specs but never enter the suite — they're enforced by other CI checks:

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
