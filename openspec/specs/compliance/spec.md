# compliance Specification

## Purpose

The `@postel/compliance` test suite as a tool — its packaging (TS runner `@postel/compliance` + language-agnostic JSON vectors under `compliance/vectors/`), CLI surface, test taxonomy, v0.1.0 scope, lockstep versioning policy with the rest of the `@postel/*` release train, sender-side deferral, and changelog discipline. The behavioral oracle that gates every port's claim of conformance — what every port (TypeScript today; Go / Python / Rust tomorrow) MUST pass at the release version it ships.

Distinct from [`standard-webhooks-compliance`](../standard-webhooks-compliance/spec.md), which owns the wire-format contract this suite enforces. Where `standard-webhooks-compliance` says *what* a conformant wire format is, this capability says *how* we know a port honors it.
## Requirements
### Requirement: Suite identity — vendor-neutral oracle for CONTRACT-level behavior

The `@postel/compliance` suite SHALL be the executable boundary of CONTRACT (per [ADR 0008](../../../decisions/0008-conformance-levels.md)). It MUST verify any HTTP receiver claiming Standard Webhooks compliance, regardless of implementation language or vendor. The suite MUST NOT couple to internals of any specific port; it consumes only the receiver's HTTP surface and any externally-published artifacts (JWKS).

The wire-format contract the suite enforces is owned by [`standard-webhooks-compliance`](../standard-webhooks-compliance/spec.md). This capability owns the **tool** that enforces it.

#### Scenario: Run against the TS port

- **WHEN** CI runs `@postel/compliance` against a receiver built with `@postel/edge`
- **THEN** the suite reports 100% pass on the v0.1.0 scope

#### Scenario: Run against a third-party receiver

- **WHEN** a user points the suite at any HTTP receiver claiming Standard Webhooks compliance
- **THEN** the suite reports a per-test pass/fail breakdown without depending on Postel-specific behavior

#### Scenario: Vendor neutrality

- **WHEN** the suite is run against a receiver implemented by a third party (no Postel code)
- **THEN** all CONTRACT-level scenarios execute and report results
- **AND** no test requires access to the receiver's source code, storage, or process

### Requirement: Hybrid architecture — language-agnostic vectors + per-language runner

The suite SHALL be split into two artifacts:

- **Test vectors**: language-agnostic JSON files under `compliance/vectors/`. Each vector encodes inputs (keys, signatures, timestamps, payloads, headers), the requirement it covers, and the expected receiver outcome (`accept` | `reject:<error-code>`).
- **Runner**: per-language package that consumes the vectors and drives a target HTTP receiver. The TypeScript runner ships as `@postel/compliance` (published from `typescript/packages/compliance/`).

Future Go / Python / Rust runners MUST consume the same `compliance/vectors/` JSON without forking the corpus. A vector's behavior is identical regardless of which runner exercises it.

#### Scenario: Vectors are runner-agnostic

- **WHEN** the same JSON vector is exercised by the TS runner and by a hypothetical Go runner against the same target
- **THEN** both runners produce the same pass/fail verdict
- **AND** any divergence is a runner bug, not a vector ambiguity

#### Scenario: Each vector names its requirement

- **WHEN** a contributor inspects any vector file under `compliance/vectors/`
- **THEN** the vector includes a `requirement` field naming the capability and the `### Requirement: <title>` it covers verbatim
- **AND** removing the named requirement from the capability spec means the vector is orphaned and MUST be removed in the same change

#### Scenario: Vector schema is versioned

- **WHEN** the vector JSON schema itself changes (field added, field removed, semantic shift)
- **THEN** the change is recorded in `compliance/CHANGELOG.md`
- **AND** every runner MUST handle vector-schema MINOR bumps backward-compatibly

### Requirement: CLI surface

The TS runner SHALL expose a CLI invocable as `npx @postel/compliance --target <url> [--format json|tap|junit]`. The CLI MUST exit non-zero if any test fails against the target.

- `--target <url>` — REQUIRED. The HTTP receiver URL the suite drives requests against.
- `--format <json|tap|junit>` — OPTIONAL. Output format. Default is human-readable text. JSON output is machine-readable and used by port CIs.

Other ports MAY expose equivalent CLIs (`go run ...`, `python -m ...`, `cargo run ...`); the flag surface above is the cross-port shape. **[PORT-SPECIFIC]** applies to the invocation mechanism (`npx` vs `go run` vs `python -m`) and to language-idiomatic output formatting beyond the three required formats.

**Conformance**: the **flag set + semantics + exit-code rules** are CONTRACT (cross-port). The **invocation mechanism** and **language-idiomatic extras** are PORT-SPECIFIC.

#### Scenario: Test failure exits non-zero

- **WHEN** any test in the suite fails against the target
- **THEN** the CLI exits with a non-zero status code
- **AND** the failing test's name, category, and the requirement it covers appear in the output

#### Scenario: JSON output is machine-readable

- **WHEN** the CLI is invoked with `--format json`
- **THEN** stdout is a single valid JSON document with per-test results, categories, and the requirement each test covers
- **AND** the document includes the suite version and the target URL

#### Scenario: TAP and JUnit formats

- **WHEN** the CLI is invoked with `--format tap` or `--format junit`
- **THEN** stdout conforms to the respective format and is consumable by standard CI test reporters

### Requirement: Test categorization by capability and sub-category

Each test SHALL belong to a `<capability>/<sub-category>/<vector-id>` path. The capability is the OpenSpec capability name; the sub-category groups related scenarios. Examples:

- `standard-webhooks-compliance/signature-v1/valid`
- `standard-webhooks-compliance/signature-v1/tampered-body`
- `standard-webhooks-compliance/signature-v1a/missing-signature`
- `receiver/timestamp-window/past-stale`
- `receiver/raw-bytes/json-reserialized`
- `key-management/jwks/kid-lookup`
- `receiver/dedup/concurrent-atomicity`

This path is the test's stable identifier across versions and is what changelogs, CLI output, and port adoption decisions reference.

#### Scenario: Stable test paths

- **WHEN** a vector is renamed for clarity within the same MINOR
- **THEN** the change is a breaking change to the test path and gates on a MAJOR bump
- **AND** until the MAJOR, the original path remains the canonical identifier

#### Scenario: Categorization filters in CLI

- **WHEN** the CLI is invoked with a filter (e.g., `--only standard-webhooks-compliance/signature-v1/*`)
- **THEN** only matching tests run
- **AND** the exit code reflects only the matched tests' verdicts

### Requirement: Lockstep versioning across `@postel/*` packages

`@postel/compliance` SHALL share `MAJOR.MINOR` with every other `@postel/*` package — the suite is one member of the shared `@postel/*` release train per [VISION.md §8](../../../VISION.md). All packages release together at each MINOR cut; PATCH releases MAY ship independently per package (bugfix discipline) but the suite version a port claims conformance against is its own MINOR.

A `@postel/*` port version `X.Y.Z` claims conformance by passing `@postel/compliance@X.Y.*` end-to-end. There is no ADVISORY phase, no runway window, and no independent suite versioning: the test corpus at version `X.Y` is what every conformant port at version `X.Y` MUST satisfy. New tests land in the MINOR release where they first appear and are required from that release on — no opt-in or grace period.

Breaking modifications, test removals, and breaking structural changes follow the same MAJOR-bump rule that governs every `@postel/*` package — there is no separate suite-lifecycle vocabulary. Pre-1.0 (`0.x`) lives under the experimental-semantics regime per VISION §8: MINORs MAY break ports, and the OpenSpec change history is the canonical record of what changed.

The runway-based evolution model previously sketched in [ADR 0009](../../../decisions/0009-compliance-suite-evolution.md) is **Deferred**: revisit once a second independently-maintained port (likely the Go receiver per [ADR 0005](../../../decisions/0005-polyglot-staged-rollout.md)) makes graduated adoption operationally valuable. Until then, lockstep is the simpler, sufficient model.

**Conformance**: the lockstep coordination and the `X.Y` version-match rule are CONTRACT (cross-port). The CI mechanism each port uses to verify it passes (harness language, scheduling, output parsing) is PORT-SPECIFIC.

#### Scenario: Suite and ports share `X.Y`

- **WHEN** `@postel/compliance` is published at version `X.Y.0`
- **THEN** every other `@postel/*` package released alongside it also takes version `X.Y.0`
- **AND** each port version `X.Y.0` passes `@postel/compliance@X.Y.0` end-to-end before release

#### Scenario: New tests are required at the version they ship

- **WHEN** a new test vector lands in the suite as part of MINOR `X.Y`
- **THEN** every port releasing at version `X.Y.0` (or later within that MINOR) MUST pass the new test
- **AND** there is no opt-in, default-off, or grace-period mode for the test

#### Scenario: Breaking modification gates on MAJOR

- **WHEN** a test's expected behavior changes in a way incompatible with the prior version (a port passing the old test would now fail the new)
- **THEN** the change lands in a MAJOR release alongside the matching capability-spec update
- **AND** every `@postel/*` package bumps MAJOR together

#### Scenario: Test removal in MAJOR

- **WHEN** a test is removed from the corpus
- **THEN** the removal lands in a MAJOR release
- **AND** the corresponding CONTRACT requirement in the capability spec becomes PORT-SPECIFIC or is removed in the same change

#### Scenario: Pre-1.0 breakage is allowed in MINORs

- **WHEN** a `0.x` MINOR introduces a behavior-changing test under the experimental-semantics regime
- **THEN** ports adapting to the new MINOR MAY need to ship code changes alongside the version bump
- **AND** this is documented in the OpenSpec change that authored the test, not in a separate runway timeline

### Requirement: Structured changelog at compliance/CHANGELOG.md

The suite SHALL maintain a structured Keep-a-Changelog-style log at `compliance/CHANGELOG.md`. Every test addition, modification, or removal SHALL appear as an entry citing:

- The OpenSpec change that motivated it.
- The capability + `### Requirement: <title>` it covers.
- The release version (`X.Y.Z`) in which the addition / modification / removal lands.

This changelog is the planning surface port maintainers consult before bumping their version. The CLI's `--format json` output SHALL expose the per-test metadata (capability, requirement, vector path) for the suite version being run.

#### Scenario: Test addition recorded

- **WHEN** a new vector lands in the suite
- **THEN** `compliance/CHANGELOG.md` gains an entry under the version being prepared, naming the OpenSpec change, the capability + requirement, and the release version

#### Scenario: Modification or removal recorded

- **WHEN** a test is modified (breaking) or removed
- **THEN** the changelog records the modification or removal under the MAJOR version that ships it
- **AND** the entry cites the OpenSpec change and the capability requirement that changed accordingly

### Requirement: v0.1.0 initial test scope — receiver-side wire-format and signing behavior

The v0.1.0 corpus SHALL cover the following test vectors. Each vector exercises an externally-observable behavior derived from existing CONTRACT requirements in `standard-webhooks-compliance`, `receiver`, and `key-management`. The list below is exhaustive for the v0.1.0 set; vectors not listed are out-of-scope for v0.1.0 and land in subsequent MINOR (or MAJOR) releases under the lockstep model.

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

#### Scenario: All v0.1.0 vectors enumerated

- **WHEN** the CLI is invoked with `--format json` against `@postel/compliance@0.1.0`
- **THEN** the output's test set matches the list above, no more and no less

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
3. Receiver-first matches [VISION.md §7](../../../VISION.md) success criterion #1 (Cloudflare Workers ≤ 50 KB) and the polyglot rollout starting with the Go *receiver* per [ADR 0005](../../../decisions/0005-polyglot-staged-rollout.md).

These tests SHALL land in subsequent MINOR (or MAJOR) releases as sender code lands and the architecture for "drive a target sender" is designed. The current change does NOT prescribe that architecture.

#### Scenario: v0.1.0 has no sender vectors

- **WHEN** the v0.1.0 corpus is enumerated
- **THEN** no vector under `sender/*`, `retry-policy/*`, `replay-reconciliation/*`, `storage-layer/worker-lease/*`, `endpoint-management/state-machine/*`, or `filtering-transformation/*` appears

#### Scenario: Out-of-scope is documented in the changelog

- **WHEN** a port maintainer reads `compliance/CHANGELOG.md` for v0.1.0
- **THEN** the v0.1.0 entry includes an explicit "Out of scope" section naming the deferred capabilities and the reason
- **AND** the entry indicates these are deferred to a later release, not removed

### Requirement: Test ↔ requirement traceability is enforced

Every test in the suite SHALL map to exactly one CONTRACT requirement in a capability spec (`openspec/specs/<capability>/spec.md`). The mapping SHALL be machine-checkable: a CI check SHALL fail if a test cites a requirement that does not exist, or if a CONTRACT requirement targeted by v0.1.0 has no covering test once tests land.

The forward direction (every test maps to a requirement) is enforced by the vector's `requirement` field plus a CI check.
The backward direction (every v0.1.0-scope CONTRACT requirement is covered) is enforced by the existing [scripts/check-spec-drift.mjs](../../../scripts/check-spec-drift.mjs) once test files exist.

#### Scenario: Test cites missing requirement

- **WHEN** a vector's `requirement` field names a `### Requirement: <title>` that does not exist in `openspec/specs/`
- **THEN** the suite's CI check fails with a clear message naming the orphan vector

#### Scenario: CONTRACT requirement without coverage

- **WHEN** a v0.1.0-scope CONTRACT requirement (per the enumerated list above) has no matching test in the runner's test tree
- **THEN** `scripts/check-spec-drift.mjs` fails as it does today, naming the uncovered requirement

