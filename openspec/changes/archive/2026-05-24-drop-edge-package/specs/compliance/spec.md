## MODIFIED Requirements

### Requirement: Suite identity — vendor-neutral oracle for CONTRACT-level behavior

The `@postel/compliance` suite SHALL be the executable boundary of CONTRACT (per [ADR 0008](../../../decisions/0008-conformance-levels.md)). It MUST verify any HTTP receiver claiming Standard Webhooks compliance, regardless of implementation language or vendor. The suite MUST NOT couple to internals of any specific port; it consumes only the receiver's HTTP surface and any externally-published artifacts (JWKS).

The wire-format contract the suite enforces is owned by [`standard-webhooks-compliance`](../standard-webhooks-compliance/spec.md). This capability owns the **tool** that enforces it.

#### Scenario: Run against the first-party reference port

- **WHEN** CI runs `@postel/compliance` against the reference receiver (the TS `@postel/core` build today; future ports' receivers tomorrow)
- **THEN** the suite reports 100% pass on the v0.1.0 scope

#### Scenario: Run against a third-party receiver

- **WHEN** a user points the suite at any HTTP receiver claiming Standard Webhooks compliance
- **THEN** the suite reports a per-test pass/fail breakdown without depending on Postel-specific behavior

#### Scenario: Vendor neutrality

- **WHEN** the suite is run against a receiver implemented by a third party (no Postel code)
- **THEN** all CONTRACT-level scenarios execute and report results
- **AND** no test requires access to the receiver's source code, storage, or process

### Requirement: v0.1.0 initial test scope — receiver-side wire-format and signing behavior

The v0.1.0 corpus SHALL cover the CONTRACT requirements enumerated below. The vector list that follows the table is the implementation-level expansion (~33 vectors across 8 sub-categories); the **contracts are the authoritative scope**, the vectors are how the contracts are exercised.

**v0.1.0 contract set** (11 CONTRACT requirements):

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
| `receiver` | Idempotency dedup helper *(HTTP-observable scenarios only; the "Redis is opt-in only" scenario is a packaging assertion, structurally untestable by the suite)* |
| `key-management` | JWKS endpoint mounter |
| `key-management` | JWKS publishes only public keys |

**Structurally untestable through the suite** (CONTRACT but the suite is not the right gate; gated by other CI checks): `receiver` Constant-time signature comparison (timing analysis), `receiver` Verify latency budgets (perf benchmark harness), `receiver` No payload contents in logs (internal observable), `receiver` Test fixtures for signed payloads (library API surface), and all library-API key-management items (symmetric/asymmetric generation, encryption at rest, ephemeral-key auto-rotation API surface, …). These never enter the suite's scope and SHALL be flagged as such in `compliance/CHANGELOG.md` for `0.1.0`.

**Deferred to later MINOR / MAJOR releases**: all sender-side capabilities (per the next requirement), `standard-webhooks-compliance` Wraps the official signing library (upstream-vector interop), `standard-webhooks-compliance` Versioning extension (`webhook-version` header), `standard-webhooks-compliance` IETF-alignment compatibility mode, `key-management` Ephemeral keys via auto-rotation full coverage, and the suite-untestable behaviors of `endpoint-management`, `multi-tenancy`, `observability`, `replay-reconciliation`, `retry-policy`, `storage-layer` worker lease, and `filtering-transformation`.

**v0.1.0 vector enumeration** — the test files that implement the contract set. Vectors not listed are out-of-scope for v0.1.0 and land in subsequent MINOR (or MAJOR) releases under the lockstep model.

**Wire-format header conformance** (covers `standard-webhooks-compliance` headers requirement):
- `wire-format/headers/all-present-accept` — request with `webhook-id`, `webhook-timestamp`, `webhook-signature` is accepted.
- `wire-format/headers/missing-id-reject`, `wire-format/headers/missing-timestamp-reject`, `wire-format/headers/missing-signature-reject`.
- `wire-format/headers/malformed-signature-reject` — signature header not of form `<version>,<base64>`.

**Signature v1 HMAC** (covers `standard-webhooks-compliance` signing + `receiver` verify-error vocabulary):
- `signature-v1/valid` — correctly signed request is accepted.
- `signature-v1/tampered-body` — body modified after signing → `SIGNATURE_INVALID`.
- `signature-v1/missing-signature` — no `v1` tuple in header → reject.
- `signature-v1/wrong-key` — signed with key A, target verifies against key B → `SIGNATURE_INVALID`.
- `signature-v1/future-timestamp` — `webhook-timestamp` more than the window in the future → `TIMESTAMP_TOO_OLD` (or equivalent out-of-window code).
- `signature-v1/past-timestamp` — `webhook-timestamp` more than the window in the past → `TIMESTAMP_TOO_OLD`.
- `signature-v1/replay-within-window` — same `webhook-id` replayed within the dedup TTL → second is rejected as duplicate. (Per the `receiver` capability spec, dedup is a CONTRACT requirement; a target without dedup is not v0.1.0-conformant.)
- `signature-v1/replay-outside-window` — same `webhook-id` replayed after the timestamp window → rejected by the window before dedup is consulted.

**Signature v1a Ed25519** (covers the asymmetric scheme):
- Same matrix as v1, against an Ed25519 keypair (`whsk_` / `whpk_` prefixes), with key material discovered via JWKS or supplied to the target as a public key.

**Multi-secret rotation window** (covers `receiver` `Multi-secret window` requirement):
- `receiver/multi-secret/old-secret-accept` — request signed with the old (verifying) secret during the rotation window is accepted; the target indicates which secret matched.
- `receiver/multi-secret/expired-secret-reject` — after the rotation window closes, requests signed with the expired secret are rejected.

**Timestamp window enforcement** (covers `receiver` `Timestamp window enforcement`):
- `receiver/timestamp-window/within-default-accept`, `receiver/timestamp-window/outside-default-reject`, parameterized for the 5-minute default and a configurable narrower window.

**Raw-bytes preservation** (covers `receiver` `Framework adapters preserve raw bytes`):
- `receiver/raw-bytes/byte-identical-accept` — verify succeeds when the receiver presents bytes byte-identical to what Postel signed.
- `receiver/raw-bytes/json-reserialized-reject` — request where the receiver round-tripped the JSON body (re-serialized) → signature fails verification, detectable by the suite.

**JWKS basics** (covers `key-management` `JWKS endpoint mounter` + `JWKS publishes only public keys` and `standard-webhooks-compliance` `JWKS discovery extension`):
- `jwks/kid-lookup` — incoming request carries a `kid`; verification proceeds against the matching key from the published JWKS.
- `jwks/rotation` — a key with a `not_after` past now-time is no longer used for signing; new keys appear in the JWKS document.
- `jwks/public-only` — no JWKS entry exposes private key material.

**Dedup atomicity** (covers `receiver` `Idempotency dedup helper` concurrent-call scenario):
- `receiver/dedup/first-receipt`, `receiver/dedup/duplicate-receipt`, `receiver/dedup/concurrent-atomicity` — under concurrent calls with the same id, exactly one succeeds as non-duplicate.

#### Scenario: All v0.1.0 contracts and vectors enumerated

- **WHEN** the CLI is invoked with `--format json` and the suite is at version `0.1.x`
- **THEN** the output's test set matches the vector enumeration above (~33 vectors), no more and no less
- **AND** the union of the vectors' `requirement` fields equals the 11 CONTRACT requirements in the contract-set table above

#### Scenario: v0.1.0 contract set matches the changelog

- **WHEN** a contributor reads `compliance/CHANGELOG.md` for `0.1.0`
- **THEN** the entry lists the same 11 CONTRACT requirements as the table in this spec, the same vector enumeration, and the same structurally-untestable + deferred lists
- **AND** divergence between the spec and the changelog is a bug to fix before release

#### Scenario: Target without dedup fails v0.1.0

- **WHEN** the target receiver does not implement dedup
- **THEN** the `signature-v1/replay-within-window` and `receiver/dedup/*` vectors fail
- **AND** the CLI exits non-zero (dedup is a CONTRACT requirement in `receiver`; without it the target is not v0.1.0-conformant)

### Requirement: v0.1.0 explicit out-of-scope — sender-side behavior

Sender-side behavioral tests SHALL NOT ship in the v0.1.0 corpus. Specifically out-of-scope:

- **Retry policy** — attempt sequencing, backoff schedule, dead-letter transitions, auto-disable.
- **Replay** — `replay-reconciliation` operator-facing semantics (range replay, replay-safety contract).
- **Lease lifecycle** — worker lease acquisition / renewal / expiry.
- **Fanout** — multi-endpoint dispatch from a single event.
- **Outbox semantics** — host-transaction passthrough, exactly-once enqueue, `_postel_meta` schema version checks.
- **Endpoint state machine** — `active | disabled | circuit-open` transitions, audit trail.

These behaviors are CONTRACT requirements in their respective capability specs, but exercising them requires a Postel sender to run *as a process*, not just an HTTP receiver to drive requests at. v0.1.0 chooses receiver-only conformance because:

1. The receiver-side surface is what a third-party "claims Standard Webhooks compliance" can plausibly mean today.
2. There is no Postel sender code yet to write sender-side tests against.
3. Receiver-first matches the polyglot rollout starting with the Go *receiver* per [ADR 0005](../../../decisions/0005-polyglot-staged-rollout.md).

These tests SHALL land in subsequent MINOR (or MAJOR) releases as sender code lands and the architecture for "drive a target sender" is designed. The current change does NOT prescribe that architecture.

#### Scenario: v0.1.0 has no sender vectors

- **WHEN** the v0.1.0 corpus is enumerated
- **THEN** no vector under `sender/*`, `retry-policy/*`, `replay-reconciliation/*`, `storage-layer/worker-lease/*`, `endpoint-management/state-machine/*`, or `filtering-transformation/*` appears

#### Scenario: Out-of-scope is documented in the changelog

- **WHEN** a port maintainer reads `compliance/CHANGELOG.md` for v0.1.0
- **THEN** the v0.1.0 entry includes an explicit "Out of scope" section naming the deferred capabilities and the reason
- **AND** the entry indicates these are deferred to a later release, not removed
