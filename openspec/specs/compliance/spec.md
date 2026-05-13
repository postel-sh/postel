# compliance Specification

## Purpose

The `@postel/compliance` test suite as a tool — its packaging (TS runner `@postel/compliance` + language-agnostic JSON vectors under `compliance/vectors/`), CLI surface, test taxonomy, v0.1.0 mandatory scope, runway-based versioning policy (SemVer + ADVISORY → MANDATORY → DEPRECATED → removed), sender-side deferral, and changelog discipline. The behavioral oracle that gates every port's claim of conformance — what every port (TypeScript today; Go / Python / Rust tomorrow) MUST pass to be Postel-conformant.

Distinct from [`standard-webhooks-compliance`](../standard-webhooks-compliance/spec.md), which owns the wire-format contract this suite enforces. Where `standard-webhooks-compliance` says *what* a conformant wire format is, this capability says *how* we know a port honors it.
## Requirements
### Requirement: Suite identity — vendor-neutral oracle for CONTRACT-level behavior

The `@postel/compliance` suite SHALL be the executable boundary of CONTRACT (per [ADR 0008](../../../decisions/0008-conformance-levels.md)). It MUST verify any HTTP receiver claiming Standard Webhooks compliance, regardless of implementation language or vendor. The suite MUST NOT couple to internals of any specific port; it consumes only the receiver's HTTP surface and any externally-published artifacts (JWKS).

The wire-format contract the suite enforces is owned by [`standard-webhooks-compliance`](../standard-webhooks-compliance/spec.md). This capability owns the **tool** that enforces it.

#### Scenario: Run against the TS port

- **WHEN** CI runs `@postel/compliance` against a receiver built with `@postel/edge`
- **THEN** the suite reports 100% pass on the v0.1.0 mandatory scope

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

The TS runner SHALL expose a CLI invocable as `npx @postel/compliance --target <url> [--format json|tap|junit] [--advisory]`. The CLI MUST exit non-zero if any MANDATORY test fails against the target.

- `--target <url>` — REQUIRED. The HTTP receiver URL the suite drives requests against.
- `--format <json|tap|junit>` — OPTIONAL. Output format. Default is human-readable text. JSON output is machine-readable and used by port CIs to plan adoption.
- `--advisory` — OPTIONAL. Opt into ADVISORY tests (see runway policy). Default-off; ADVISORY tests do NOT affect exit code.

Other ports MAY expose equivalent CLIs (`go run ...`, `python -m ...`, `cargo run ...`); the flag surface above is the cross-port shape. **[PORT-SPECIFIC]** applies to the invocation mechanism (`npx` vs `go run` vs `python -m`) and to language-idiomatic output formatting beyond the three required formats.

**Conformance**: the **flag set + semantics + exit-code rules** are CONTRACT (cross-port). The **invocation mechanism** and **language-idiomatic extras** are PORT-SPECIFIC.

#### Scenario: Mandatory failure exits non-zero

- **WHEN** a MANDATORY test fails against the target
- **THEN** the CLI exits with a non-zero status code
- **AND** the failing test's name, category, and the requirement it covers appear in the output

#### Scenario: Advisory failure does not affect exit code

- **WHEN** `--advisory` is passed and an ADVISORY test fails (but all MANDATORY tests pass)
- **THEN** the CLI exits zero
- **AND** the ADVISORY failure is reported in the output

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

### Requirement: Versioning policy — SemVer with runway-based MINOR transitions

`@postel/compliance` (the TS runner) and the `compliance/vectors/` corpus SHALL follow strict SemVer (`MAJOR.MINOR.PATCH`). The TS runner package version is the authoritative suite version; the vectors corpus version is published alongside in the runner's metadata.

A test's lifecycle stage is one of:

- **ADVISORY**: present in a MINOR release but opt-in (`--advisory`). Default-off; not counted in mandatory pass/fail.
- **MANDATORY**: default-on. Failing the test means failing the suite at that version.
- **DEPRECATED**: still runs, but the result no longer counts toward "must-pass." Scheduled for removal in a subsequent MAJOR.

Transitions between stages are constrained:

- **ADDITION**: a new test lands ADVISORY in a MINOR release.
- **MANDATORY promotion**: an ADVISORY test becomes MANDATORY no sooner than the next MINOR release after a documented runway window. The runway window is recorded in `compliance/CHANGELOG.md` and SHALL be at least **6 weeks** pre-1.0 (longer post-1.0 — exact post-1.0 cadence will be revisited when the second port lands).
- **DEPRECATION**: a MANDATORY test becomes DEPRECATED in a MINOR release. It is removed no sooner than the next MAJOR after a documented runway window of at least **6 months** pre-1.0.
- **MAJOR bump**: required for any of — DEPRECATED test removal, breaking modification of a MANDATORY test (where the new behavior is incompatible with the old), structural change (test path renames, output-format changes, vector-schema breaking changes).
- **Additive modification** of a MANDATORY test (new behavior is a strict superset of old; passing new implies passing old): follows the ADDITION → ADVISORY → MANDATORY runway, same as a fresh ADDITION.

#### Scenario: New test ADVISORY in MINOR, MANDATORY in subsequent MINOR

- **WHEN** a contributor adds a test that covers a newly-introduced CONTRACT requirement
- **THEN** the test ships ADVISORY in the next MINOR release (`0.N.0`)
- **AND** it ships MANDATORY no sooner than `0.(N+1).0`, after at least the runway window has elapsed

#### Scenario: Mandatory promotion runway recorded

- **WHEN** an ADVISORY test is scheduled for MANDATORY promotion
- **THEN** `compliance/CHANGELOG.md` records the introduction date, target MANDATORY version, and the runway duration
- **AND** the CLI exposes this information via `--format json` so port CIs can plan their bump

#### Scenario: Breaking modification gates on MAJOR

- **WHEN** a MANDATORY test's expected behavior changes in a way incompatible with the old behavior (a receiver passing the old test would now fail the new)
- **THEN** the change MUST land in a MAJOR release
- **AND** the old test is removed in the same MAJOR
- **AND** the corresponding capability requirement is updated in the same OpenSpec change

#### Scenario: Deprecation runway

- **WHEN** a MANDATORY test is marked DEPRECATED
- **THEN** it still executes when the suite runs (so port maintainers can see the impact)
- **AND** its result does NOT count toward MANDATORY pass/fail
- **AND** it is removed no sooner than the next MAJOR, after at least the documented removal runway

### Requirement: Port pinning against a specific MINOR

Every port claiming conformance SHALL pin its suite dependency to a specific MINOR (`@postel/compliance@~0.1.0`, not `^0.x`). Bumping the pin SHALL be an explicit PR that cites the changelog delta between the old and new MINOR. A port version's compliance claim is "passes `@postel/compliance@<pinned-version>` MANDATORY scope."

This pinning rule is itself part of the CONTRACT: it's what gives the runway policy operational meaning. A port that doesn't pin loses the protection of the runway window.

#### Scenario: Pin is explicit

- **WHEN** a port's package manifest declares a `@postel/compliance` dependency
- **THEN** the version specifier targets a specific MINOR (e.g., `~0.1.0`, `~1.5.0`), not an open MINOR range (`^0.x`, `^1`)

#### Scenario: Pin bump references changelog

- **WHEN** a port bumps its `@postel/compliance` pin from `~0.N.0` to `~0.(N+1).0`
- **THEN** the PR description names the tests that moved from ADVISORY → MANDATORY in `0.(N+1).0`
- **AND** the PR demonstrates the port passes the new MANDATORY set

### Requirement: Structured changelog at compliance/CHANGELOG.md

The suite SHALL maintain a structured Keep-a-Changelog-style log at `compliance/CHANGELOG.md`. Every test addition, lifecycle transition (ADVISORY → MANDATORY → DEPRECATED → removed), modification, and removal SHALL appear as an entry citing:

- The OpenSpec change that motivated it.
- The capability + `### Requirement: <title>` it covers.
- The current lifecycle stage and the version that stage took effect.
- The runway timeline (introduced date, MANDATORY date, deprecated date, removal date — whichever apply).

This changelog is the primary planning surface for port maintainers. The CLI's `--format json` output SHALL expose the same data in a machine-readable form scoped to the suite version being run.

#### Scenario: Test addition recorded

- **WHEN** a new vector lands in the suite
- **THEN** `compliance/CHANGELOG.md` gains an entry under the version being prepared, naming the OpenSpec change, the capability + requirement, and the ADVISORY-since version

#### Scenario: Lifecycle transition recorded

- **WHEN** a test is promoted ADVISORY → MANDATORY, marked DEPRECATED, or removed
- **THEN** the existing changelog entry is updated (or a new dated entry is added) reflecting the transition, the version, and any newly-relevant dates

### Requirement: v0.1.0 initial mandatory scope — receiver-side wire-format and signing behavior

The v0.1.0 MANDATORY scope SHALL cover the following test vectors. Each vector exercises an externally-observable behavior derived from existing CONTRACT requirements in `standard-webhooks-compliance`, `receiver`, and `key-management`. The list below is exhaustive for the v0.1.0 MANDATORY set; vectors not listed are out-of-scope for v0.1.0.

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
- `signature-v1/replay-within-window` — same `webhook-id` replayed within the dedup TTL → second is rejected as duplicate (requires the target to implement dedup; receivers without dedup mark this ADVISORY at v0.1.0).
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

#### Scenario: All v0.1.0 MANDATORY vectors enumerated

- **WHEN** the CLI is invoked with `--format json` against `@postel/compliance@~0.1.0`
- **THEN** the output's MANDATORY test set matches the list above, no more and no less

#### Scenario: Receiver-without-dedup grace

- **WHEN** the target receiver does not implement dedup
- **THEN** the `signature-v1/replay-within-window` and `receiver/dedup/*` vectors are reported as ADVISORY-fail rather than MANDATORY-fail at v0.1.0
- **AND** the CLI exit code is unaffected by these specific ADVISORY failures

### Requirement: v0.1.0 explicit out-of-scope — sender-side behavior

Sender-side behavioral tests SHALL NOT ship in the v0.1.0 MANDATORY scope. Specifically out-of-scope:

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

- **WHEN** the v0.1.0 MANDATORY scope is enumerated
- **THEN** no vector under `sender/*`, `retry-policy/*`, `replay-reconciliation/*`, `storage-layer/worker-lease/*`, `endpoint-management/state-machine/*`, or `filtering-transformation/*` appears

#### Scenario: Out-of-scope is documented in the changelog

- **WHEN** a port maintainer reads `compliance/CHANGELOG.md` for v0.1.0
- **THEN** the v0.1.0 entry includes an explicit "Out of scope" section naming the deferred capabilities and the reason
- **AND** the entry indicates these are deferred to a later release, not removed

### Requirement: Test ↔ requirement traceability is enforced

Every MANDATORY and ADVISORY test SHALL map to exactly one CONTRACT requirement in a capability spec (`openspec/specs/<capability>/spec.md`). The mapping SHALL be machine-checkable: a CI check SHALL fail if a test cites a requirement that does not exist, or if a CONTRACT requirement targeted by v0.1.0 has no covering test once tests land.

The forward direction (every test maps to a requirement) is enforced by the vector's `requirement` field plus a CI check.
The backward direction (every v0.1.0-scope CONTRACT requirement is covered) is enforced by the existing [scripts/check-spec-drift.mjs](../../../scripts/check-spec-drift.mjs) once test files exist.

#### Scenario: Test cites missing requirement

- **WHEN** a vector's `requirement` field names a `### Requirement: <title>` that does not exist in `openspec/specs/`
- **THEN** the suite's CI check fails with a clear message naming the orphan vector

#### Scenario: CONTRACT requirement without coverage

- **WHEN** a v0.1.0-scope CONTRACT requirement (per the enumerated list above) has no matching test in the runner's test tree
- **THEN** `scripts/check-spec-drift.mjs` fails as it does today, naming the uncovered requirement

