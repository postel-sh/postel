# compliance Specification

## Purpose

The `@postel/compliance` test suite as a tool — its architecture (language-agnostic YAML test vectors + a runner whose implementation language is open, both housed at top-level `compliance/`), CLI surface, test taxonomy, vector file schema, v0.1.0 contract set, lockstep versioning with the rest of the `@postel/*` release train, sender-side deferral, and changelog discipline. The behavioral oracle that gates every port's claim of conformance — what every port (TypeScript today; Go / Python / Rust tomorrow) MUST pass at the release version it ships.

Distinct from [`standard-webhooks-compliance`](../standard-webhooks-compliance/spec.md), which owns the wire-format contract this suite enforces. Where `standard-webhooks-compliance` says *what* a conformant wire format is, this capability says *how* we know a port honors it. The suite identity `@postel/compliance` is a brand for the suite, not a claim about its implementation language or distribution channel — both of which are open implementation choices.
## Requirements
### Requirement: Suite identity — vendor-neutral oracle for CONTRACT-level behavior

The `@postel/compliance` suite SHALL be the executable boundary of CONTRACT (per [ADR 0008](../../../decisions/0008-conformance-levels.md)). It MUST verify any HTTP receiver claiming Standard Webhooks compliance, regardless of implementation language or vendor. The suite MUST NOT couple to internals of any specific port; it consumes only the receiver's HTTP surface and any externally-published artifacts (JWKS).

The wire-format contract the suite enforces is owned by [`standard-webhooks-compliance`](../standard-webhooks-compliance/spec.md). This capability owns the **tool** that enforces it.

#### Scenario: Run against the first-party reference port

- **WHEN** CI runs `@postel/compliance` against the reference receiver (the TS edge build today; future ports' receivers tomorrow)
- **THEN** the suite reports 100% pass on the v0.1.0 scope

#### Scenario: Run against a third-party receiver

- **WHEN** a user points the suite at any HTTP receiver claiming Standard Webhooks compliance
- **THEN** the suite reports a per-test pass/fail breakdown without depending on Postel-specific behavior

#### Scenario: Vendor neutrality

- **WHEN** the suite is run against a receiver implemented by a third party (no Postel code)
- **THEN** all CONTRACT-level scenarios execute and report results
- **AND** no test requires access to the receiver's source code, storage, or process

### Requirement: Two-layer architecture — vectors + runner

The suite SHALL be split into two layers, both housed under the top-level `compliance/` directory:

- **Test vectors**: language-agnostic YAML files under `compliance/vectors/`. Each vector encodes inputs (keys, signatures, timestamps, payloads, headers), the requirement it covers, and the expected receiver outcome (`accept` | `reject:<error-code>`). The vector format is defined by the "Vector file schema" requirement below.
- **Runner**: source under `compliance/<runner>/` (the directory name is the runner's chosen identifier, e.g., `compliance/cli/`). The runner reads the vectors and drives them at a target HTTP receiver. The runner's **implementation language is open** — it MAY be TypeScript, Go, Rust, Python, or any other; the choice is recorded by the change that introduces the first runner. No part of this spec assumes a particular language.

Vectors are the cross-port asset; the runner is the executable layer. If multiple runner implementations exist at any point in the project's life, they MUST produce identical verdicts on the same vector against the same target — divergence is a runner bug, not a vector ambiguity.

**Conformance**: the **vector format** (per the schema requirement) and the **target-driving semantics** are CONTRACT (cross-port). The **runner's implementation language**, **CLI command name**, **distribution channel** (npm package, container image, source build, binary release), and **internal architecture** are PORT-SPECIFIC.

#### Scenario: Vectors are language-agnostic

- **WHEN** the same vector file is exercised by any conformant runner against the same target with the same `--now` baseline
- **THEN** the verdict is identical
- **AND** any divergence between runners is a runner bug, not a vector ambiguity

#### Scenario: Each vector names its requirement

- **WHEN** a contributor inspects any vector file under `compliance/vectors/`
- **THEN** the vector includes a `requirement` field naming the capability and the `### Requirement: <title>` it covers verbatim
- **AND** removing the named requirement from the capability spec means the vector is orphaned and MUST be removed in the same change

#### Scenario: Runner source lives at top-level compliance/

- **WHEN** a contributor adds the first (or any subsequent) runner implementation
- **THEN** the source lives under `compliance/<runner-name>/`, not under any language-specific subtree (e.g., not `typescript/packages/compliance/`)
- **AND** the choice of `<runner-name>` and implementation language is recorded in the PR that introduces it

### Requirement: Vector file schema

Every test vector under `compliance/vectors/` SHALL be a YAML 1.2 file (safe subset; see below) conforming to a shared schema. The on-disk format is YAML; the in-memory structure (after parsing) is what the schema validates and is identical to what an equivalent JSON file would produce. The schema itself is CONTRACT — every runner MUST agree on the format so vectors are portable across runners without translation. Per [ADR 0011](../../../decisions/0011-compliance-suite-tooling.md), YAML was chosen over JSON for authoring ergonomics; the safe-subset constraints below dodge YAML's known footguns.

A vector file SHALL declare the following fields:

- `id` — stable test identifier of the form `<category>/<vector-id>` (e.g., `signature-v1/tampered-body`). Matches the test path established in the "Test categorization" requirement.
- `requirement` — the CONTRACT requirement this vector covers, as `{ capability, title }`. Both fields verbatim-match a `### Requirement: <title>` block in `openspec/specs/<capability>/spec.md`.
- `description` — human-readable one-line summary.
- `input` — the HTTP request the runner sends to the target. An object with `method`, `url` (path), `headers` (string map), and `body_b64` (base64-encoded raw request bytes — preserves byte-exactness across runners).
- `secrets` — array of test secret/key references used by the vector. Each entry is `{ id, fixture }` where `fixture` names a YAML file under `compliance/vectors/_keys/`.
- `signature_mode` — either `"static"` (the signature in the input header is pre-computed at vector-authoring time and frozen) or `"computed"` (the runner computes the signature at execution time, after resolving any time templates, using the named secret fixture).
- `expected` — the verdict. One of:
  - `{ outcome: "accept" }` — the receiver's verify path succeeds and dedup does not flag the message as duplicate. HTTP signal: `2xx` with no `X-Postel-Dedup-Result` header.
  - `{ outcome: "reject", error_code: "<code>" }` — verify fails. `<code>` matches the structured error vocabulary defined by the `receiver` capability spec (`SIGNATURE_INVALID`, `TIMESTAMP_TOO_OLD`, `MALFORMED_HEADER`, `UNKNOWN_KEY_ID`, `RAW_BYTES_MISMATCH_DETECTED`). HTTP signal: `4xx`/`5xx` with the error code in the `X-Postel-Verify-Error` response header or a JSON body `{ "error_code": "<code>" }`.
  - `{ outcome: "duplicate" }` — verify succeeds but the dedup helper reports the message id as already seen within its TTL. HTTP signal: `2xx` with response header `X-Postel-Dedup-Result: duplicate`. Non-dedup-aware receivers MUST NOT emit this header on the first receipt; if they never emit it, they are non-conformant against `0.1.x` per the receiver capability spec's `Idempotency dedup helper` requirement.

**YAML safe subset**: vector files SHALL use YAML 1.2 with scalars, sequences, and mappings only. No anchors, no aliases, no custom tags, no merge keys. Parsers run in safe mode (no arbitrary-type construction). Strings that could be misread as non-string types (timestamps, version numbers, boolean-shaped tokens like `yes`/`no`/`on`/`off`, two-letter codes) MUST be explicitly quoted — e.g., `webhook-timestamp: "1735689600"`, not `webhook-timestamp: 1735689600`. This avoids YAML's well-known type-coercion footguns (the Norway problem and friends) without sacrificing readability for the rest of the file.

**Time templating**: any string field MAY contain the literal token `{{now}}`, `{{now-<duration>}}`, or `{{now+<duration>}}` (durations expressed as `<integer><s|m|h>`, e.g., `{{now-10m}}`). Runners SHALL resolve these tokens against a baseline `now` supplied via `--now <ISO8601>` (default: process wall-clock at run start). Pinning `--now` in CI makes time-sensitive vectors fully reproducible.

**Signature material**: vectors with `signature_mode: "static"` carry the pre-computed signature in `input.headers["webhook-signature"]` as-is; the timestamp in `input.headers["webhook-timestamp"]` is a literal, not a template. Vectors with `signature_mode: "computed"` MAY use time templates; the runner resolves the templates, then computes the HMAC or Ed25519 signature using the referenced secret fixture, then injects the result into the outgoing request.

**Test key fixtures**: a fixed set of test keys lives under `compliance/vectors/_keys/` as YAML files. Each fixture declares `{ id, algorithm, key_material }` with `algorithm` in `{ "hmac-sha256", "ed25519" }`. Real ports SHALL NEVER reference these fixtures in production code paths — they are test-only material with documented "for-test-only" provenance.

**Schema validation in CI**: the suite SHALL ship a canonical JSON Schema describing the vector file shape (committed to the repo). CI SHALL parse every vector and validate the in-memory structure against the schema. Vectors with field-name typos, missing required fields, or wrong types fail CI with a clear message. JSON Schema is used regardless of on-disk format because the in-memory shape after YAML parsing is identical to what JSON would produce.

**Schema evolution**: the vector file schema itself is governed by the lockstep versioning rule. Adding or modifying a schema field is a CONTRACT change recorded in `compliance/CHANGELOG.md` against the release version that ships it; breaking schema changes (removing a required field, semantic shift) gate on a MAJOR bump.

#### Scenario: Vector cites a valid requirement

- **WHEN** a vector's `requirement.title` does not match any `### Requirement:` block in `openspec/specs/<requirement.capability>/spec.md`
- **THEN** the suite's CI check fails with a clear message naming the orphan vector

#### Scenario: YAML safe-subset only

- **WHEN** a vector file uses YAML anchors (`&anchor`), aliases (`*ref`), custom tags (`!!set`, `!!binary`), or merge keys (`<<:`)
- **THEN** the suite's CI parser SHALL reject the file with a clear message naming the disallowed construct
- **AND** the rejection happens before schema validation, so the safe-subset rule is independently enforceable

#### Scenario: Ambiguous strings are explicitly quoted

- **WHEN** a vector field's value could be misread as a non-string type — examples: `webhook-timestamp: 1735689600` parses as integer; `webhook-version: 2` parses as integer; a header value of `no` parses as boolean
- **THEN** schema validation rejects the vector because the typed field (e.g., a string-typed timestamp) received the wrong type
- **AND** the fix is to quote the value: `webhook-timestamp: "1735689600"`, `webhook-version: "2"`, header value `"no"`

#### Scenario: JSON-Schema validation enforces field shape

- **WHEN** the suite's CI runs against any vector (new or modified)
- **THEN** the parsed in-memory structure is validated against the canonical JSON Schema (committed to the repo)
- **AND** vectors with field-name typos, missing required fields, wrong types, or unrecognized fields fail CI with a clear message

#### Scenario: Static-signature vector is byte-stable

- **WHEN** the runner executes a `signature_mode: "static"` vector twice with the same `--now`
- **THEN** the produced HTTP request is byte-identical between runs

#### Scenario: Time templates resolve against --now

- **WHEN** the runner is invoked with `--now 2026-01-01T00:00:00Z` against a vector containing `{{now-5m}}`
- **THEN** the resolved value is `2025-12-31T23:55:00Z` (ISO-8601) or the equivalent Unix-epoch seconds where the spec field calls for a Unix timestamp
- **AND** the runner uses the resolved value when computing any `signature_mode: "computed"` signature

#### Scenario: Test keys are isolated from production keys

- **WHEN** a contributor inspects `compliance/vectors/_keys/`
- **THEN** the directory contains only test fixtures with documented "for-test-only" key material
- **AND** real ports MUST NOT reference these fixtures in production code paths

#### Scenario: Schema field addition

- **WHEN** a new field is added to the vector schema in a non-breaking way (existing vectors remain valid)
- **THEN** the change is recorded in `compliance/CHANGELOG.md` under the release version that ships it
- **AND** runners SHALL ignore fields they don't recognize (forward compatibility)

#### Scenario: Schema breaking change

- **WHEN** a schema field is removed, renamed, or its semantics change incompatibly
- **THEN** the change lands in a MAJOR release alongside every vector updated to the new shape
- **AND** the changelog records the migration explicitly

#### Scenario: Duplicate-outcome verdict has a wire-level signal

- **WHEN** a vector declares `expected: { outcome: "duplicate" }`
- **THEN** the runner SHALL classify an HTTP response as `duplicate` if and only if the status code is `2xx` and the response carries the header `X-Postel-Dedup-Result: duplicate`
- **AND** a `2xx` without that header is classified as `accept`
- **AND** a `4xx`/`5xx` is classified as `reject` regardless of the dedup header

#### Scenario: Receiver MUST emit the dedup header on the second receipt

- **WHEN** a conformant receiver processes a request whose `webhook-id` it has already accepted within the dedup TTL
- **THEN** the receiver SHALL return `2xx` with `X-Postel-Dedup-Result: duplicate`
- **AND** the receiver MUST NOT emit that header on the first receipt of any `webhook-id`

### Requirement: CLI surface

The runner SHALL expose a CLI accepting at minimum the following flag surface:

- `--target <url>` — REQUIRED. The HTTP receiver URL the suite drives requests against.
- `--format <json|tap|junit>` — OPTIONAL. Output format. Default is human-readable text. JSON output is machine-readable and is what port CIs and the suite's own test-discovery tooling consume.
- `--now <ISO8601>` — OPTIONAL. Baseline timestamp for resolving `{{now±<duration>}}` templates in vectors. Default: process wall-clock at run start.

The CLI MUST exit non-zero if any test fails against the target.

The **invocation mechanism** is intentionally unspecified — it depends on the runner's implementation language (`./compliance --target …`, `npx @postel/compliance --target …`, `go run ./compliance --target …`, `python -m compliance --target …`, container, binary, etc.). What matters cross-port is the flag set, the exit-code semantics, and the output formats.

**Conformance**: the **flag set + semantics + exit-code rules + output formats** are CONTRACT (cross-port). The **invocation mechanism**, **CLI command name**, and **language-idiomatic extras** are PORT-SPECIFIC.

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

### Requirement: Lockstep versioning with the `@postel/*` release train

The compliance suite (vectors + runner) SHALL share `MAJOR.MINOR` with every `@postel/*` port package, per [VISION.md §8](../../../VISION.md)'s shared-release-train rule. The suite's distribution channel (npm package, container image, source build, binary release) is open and a PORT-SPECIFIC choice; the version coordination is CONTRACT regardless of channel.

All `@postel/*` ports and the suite release together at each MINOR cut. PATCH releases MAY ship independently per artifact (bugfix discipline), but the suite version a port claims conformance against is its own MINOR.

A port version `X.Y.Z` claims conformance by passing the compliance suite at version `X.Y.*` end-to-end. There is no ADVISORY phase, no runway window, and no independent suite versioning: the test corpus at version `X.Y` is what every conformant port at version `X.Y` MUST satisfy. New tests land in the MINOR release where they first appear and are required from that release on — no opt-in or grace period.

Breaking modifications, test removals, and breaking structural changes follow the same MAJOR-bump rule that governs every `@postel/*` package — there is no separate suite-lifecycle vocabulary. Pre-1.0 (`0.x`) lives under the experimental-semantics regime per VISION §8: MINORs MAY break ports, and the OpenSpec change history is the canonical record of what changed.

The runway-based evolution model previously sketched in [ADR 0009](../../../decisions/0009-compliance-suite-evolution.md) is **Deferred**: revisit once a second independently-maintained port (likely the Go receiver per [ADR 0005](../../../decisions/0005-polyglot-staged-rollout.md)) makes graduated adoption operationally valuable. Until then, lockstep is the simpler, sufficient model.

**Conformance**: the lockstep coordination and the `X.Y` version-match rule are CONTRACT (cross-port). The CI mechanism each port uses to verify it passes (harness language, scheduling, output parsing) and the suite's distribution channel are PORT-SPECIFIC.

#### Scenario: Suite and ports share `X.Y`

- **WHEN** the compliance suite is released at version `X.Y.0`
- **THEN** every `@postel/*` port package released alongside it also takes version `X.Y.0`
- **AND** each port version `X.Y.0` passes the compliance suite at `X.Y.0` end-to-end before release

#### Scenario: New tests are required at the version they ship

- **WHEN** a new test vector lands in the suite as part of MINOR `X.Y`
- **THEN** every port releasing at version `X.Y.0` (or later within that MINOR) MUST pass the new test
- **AND** there is no opt-in, default-off, or grace-period mode for the test

#### Scenario: Breaking modification gates on MAJOR

- **WHEN** a test's expected behavior changes in a way incompatible with the prior version (a port passing the old test would now fail the new)
- **THEN** the change lands in a MAJOR release alongside the matching capability-spec update
- **AND** every `@postel/*` package and the suite bump MAJOR together

#### Scenario: Test removal in MAJOR

- **WHEN** a test is removed from the corpus
- **THEN** the removal lands in a MAJOR release
- **AND** the corresponding CONTRACT requirement in the capability spec becomes PORT-SPECIFIC or is removed in the same change

#### Scenario: Pre-1.0 breakage is allowed in MINORs

- **WHEN** a `0.x` MINOR introduces a behavior-changing test under the experimental-semantics regime
- **THEN** ports adapting to the new MINOR MAY need to ship code changes alongside the version bump
- **AND** this is documented in the OpenSpec change that authored the test, not in a separate runway timeline

#### Scenario: Distribution channel is open

- **WHEN** the suite is consumed by a port's CI
- **THEN** the consumption mechanism (npm install, container pull, binary download, repo checkout at a tagged commit) is the port's choice
- **AND** what matters is the suite version actually exercised, not how it was obtained

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

**Structurally untestable through the suite** (CONTRACT but the suite is not the right gate; gated by other CI checks): `receiver` Edge bundle size budget (bundle-size CI), `receiver` Edge runtime portability (CI deploy test), `receiver` Constant-time signature comparison (timing analysis), `receiver` Verify latency budgets (perf benchmark harness), `receiver` No payload contents in logs (internal observable), `receiver` Test fixtures for signed payloads (library API surface), and all library-API key-management items (symmetric/asymmetric generation, encryption at rest, ephemeral-key auto-rotation API surface, …). These never enter the suite's scope and SHALL be flagged as such in `compliance/CHANGELOG.md` for `0.1.0`.

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

