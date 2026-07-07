# compliance Specification

## Purpose

The `@postel/compliance` test suite as a tool — its architecture (language-agnostic YAML test vectors + a runner whose implementation language is open, both housed at top-level `compliance/`), CLI surface, test taxonomy, vector file schema, v0.1.0 contract set, lockstep versioning with the rest of the `@postel/*` release train, sender-side deferral, and changelog discipline. The behavioral oracle that gates every port's claim of conformance — what every port (TypeScript today; Go / Python / Rust tomorrow) MUST pass at the release version it ships.

Distinct from [`standard-webhooks-compliance`](../standard-webhooks-compliance/spec.md), which owns the wire-format contract this suite enforces. Where `standard-webhooks-compliance` says *what* a conformant wire format is, this capability says *how* we know a port honors it. The suite identity `@postel/compliance` is a brand for the suite, not a claim about its implementation language or distribution channel — both of which are open implementation choices.
## Requirements
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

### Requirement: Two-layer architecture — vectors + runner

The suite SHALL be split into two layers, both housed under the top-level `compliance/` directory:

- **Test vectors**: language-agnostic YAML files under `compliance/vectors/`. Each vector encodes inputs (keys, signatures, timestamps, payloads, headers) for receiver-mode tests, or control-plane triggers and expected outgoing requests for sender-mode tests. The vector format is defined by the *Vector file schema* requirement.
- **Runner**: source under `compliance/<runner>/` (the directory name is the runner's chosen identifier, e.g., `compliance/cli/`). The runner reads the vectors and either drives them at a target HTTP receiver (receiver mode, `--target`) or drives a sender-under-test through the control plane while observing outgoing HTTP on an embedded mock receiver (sender mode, `--sender-control`). The runner's **implementation language is open**.

Vectors are the cross-port asset; the runner is the executable layer. If multiple runner implementations exist at any point in the project's life, they MUST produce identical verdicts on the same vector against the same target — divergence is a runner bug, not a vector ambiguity.

**Conformance**: the **vector format** and the **target-driving semantics** (both modes) are CONTRACT. The **runner's implementation language**, **CLI command name**, **distribution channel**, and **internal architecture** are PORT-SPECIFIC. The embedded mock-receiver host the runner stands up in sender mode is part of the CONTRACT (a sender-under-test is allowed to assume it can resolve and POST to it during a vector).

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
- **THEN** the source lives under `compliance/<runner-name>/`, not under any language-specific subtree
- **AND** the choice of `<runner-name>` and implementation language is recorded in the PR that introduces it

### Requirement: Vector file schema

Every test vector under `compliance/vectors/` SHALL be a YAML 1.2 file (safe subset) conforming to a shared schema. The on-disk format is YAML; the in-memory structure after parsing is what the schema validates and is identical to what an equivalent JSON file would produce. The schema is CONTRACT — every runner agrees on the format so vectors are portable across runners without translation.

A vector file SHALL declare the following fields:

- `id` — stable test identifier of the form `<category>/<vector-id>`.
- `requirement` — the CONTRACT requirement this vector covers, as `{ capability, title }`. Both fields verbatim-match a `### Requirement: <title>` block in `openspec/specs/<capability>/spec.md`.
- `description` — human-readable one-line summary.
- `mode` — OPTIONAL discriminator. Either `"receiver"` (default) or `"sender"`. Absent is equivalent to `"receiver"` to keep v0.1.0 vectors backward-compatible.
- **Receiver mode (`mode: "receiver"` or omitted)** — REQUIRED `input` and `signature_mode` fields as previously defined: `input.method`, `input.url`, `input.headers`, `input.body_b64`; `signature_mode` is `"static" | "computed"`; `secrets[]` references key fixtures.
- **Sender mode (`mode: "sender"`)** — REQUIRED `triggers[]`, OPTIONAL `mock_receiver{}`, OPTIONAL `expected_requests[]`. `triggers[]` is an ordered list of control-plane operations: `register_endpoint`, `send`, `start_workers`, `advance_clock`, `wait_for`. `mock_receiver.scripted_responses[]` programs per-request HTTP responses from the embedded mock receiver. `expected_requests[]` is a length-exact list of asserted outgoing HTTP requests (matching headers, body, signature verification against a fixture, optional timing assertion via `arrived_within_ms`, optional `attempt_status` assertion read back via `/control/messages/:id`).
- `expected` — for sender vectors, `outcome: "accept"` means all expected_requests matched; `outcome: "reject"` means the control-plane call itself rejected (e.g., `EndpointValidation`); receiver-mode semantics are unchanged.

**YAML safe subset** unchanged.

**Time templating** — sender vectors MAY use `{{now±duration}}` templates inside trigger fields; resolved against `--now`. The `advance_clock` trigger drives the sender's virtual clock independently of `--now`.

**Signature material** — sender vectors with `signing: { fixture_id }` in a `register_endpoint` trigger have the runner load the fixture key from `compliance/vectors/_keys/<fixture>.yaml`, ship it to the sender via `/control/keys/install` or `register_endpoint` directly, and verify outgoing `webhook-signature` headers against the same fixture in `expected_requests[].signature_verifies`.

#### Scenario: Sender vector declares mode: sender

- **WHEN** a vector under `compliance/vectors/sender/` carries `mode: "sender"` with `triggers[]` and `expected_requests[]`
- **THEN** schema validation accepts the file
- **AND** the runner dispatches to `executeSenderVector` instead of the receiver-mode path

#### Scenario: Receiver-mode vectors continue to validate against the schema unchanged

- **WHEN** the runner is at suite version `0.2.x` and processes a vector from `compliance/vectors/{wire-format,signature-v1,signature-v1a,receiver,jwks}/` lacking a `mode` field
- **THEN** the schema treats it as `mode: "receiver"` and the legacy `input`/`signature_mode`/`expected` flow runs unchanged

#### Scenario: Triggers execute in document order

- **WHEN** a sender vector lists `triggers: [register_endpoint, send, start_workers, wait_for]`
- **THEN** the runner issues those control-plane calls in document order
- **AND** the recorded outgoing HTTP requests are matched against `expected_requests[]` only after `wait_for` resolves

#### Scenario: Signature verifies against fixture key material

- **WHEN** a sender vector's `expected_requests[].signature_verifies` names a fixture id matching the one used in `register_endpoint`
- **THEN** the runner uses the fixture's key material to verify the observed `webhook-signature` header against the canonical Standard Webhooks signing input (`webhook-id`.`webhook-timestamp`.`body`)

#### Scenario: YAML safe-subset only

- **WHEN** a vector file uses YAML anchors (`&anchor`), aliases (`*ref`), custom tags, or merge keys (`<<:`)
- **THEN** the suite's CI parser SHALL reject the file with a clear message naming the disallowed construct
- **AND** the rejection happens before schema validation

#### Scenario: Ambiguous strings are explicitly quoted

- **WHEN** a vector field's value could be misread as a non-string type (e.g., `webhook-timestamp: 1735689600` parses as integer; a header value of `no` parses as boolean)
- **THEN** schema validation rejects the vector
- **AND** the fix is to quote the value

#### Scenario: JSON-Schema validation enforces field shape

- **WHEN** the suite's CI runs against any vector
- **THEN** the parsed in-memory structure is validated against the canonical JSON Schema committed to the repo
- **AND** vectors with field-name typos, missing required fields, wrong types, or unrecognized fields fail CI with a clear message

#### Scenario: Static-signature vector is byte-stable

- **WHEN** the runner executes a receiver-mode `signature_mode: "static"` vector twice with the same `--now`
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

#### Scenario: Duplicate-outcome verdict has a wire-level signal

- **WHEN** a vector declares `expected: { outcome: "duplicate" }`
- **THEN** the runner SHALL classify an HTTP response as `duplicate` if and only if the status code is `2xx` and the response carries the header `X-Postel-Dedup-Result: duplicate`

#### Scenario: Receiver MUST emit the dedup header on the second receipt

- **WHEN** a conformant receiver processes a request whose `webhook-id` it has already accepted within the dedup TTL
- **THEN** the receiver SHALL return `2xx` with `X-Postel-Dedup-Result: duplicate`
- **AND** the receiver MUST NOT emit that header on the first receipt of any `webhook-id`

#### Scenario: Vector cites a valid requirement

- **WHEN** a vector's `requirement.title` does not match any `### Requirement:` block in `openspec/specs/<requirement.capability>/spec.md`
- **THEN** the suite's CI check fails with a clear message naming the orphan vector

### Requirement: CLI surface

The runner SHALL expose a CLI accepting at minimum the following flag surface:

- `--target <url>` — REQUIRED for receiver-mode runs. The HTTP receiver URL the suite drives requests against. Mutually exclusive with `--sender-control`.
- `--sender-control <url>` — REQUIRED for sender-mode runs. The compliance driver URL the suite drives the sender-under-test via. Mutually exclusive with `--target`.
- `--mock-receiver-host <host>` — OPTIONAL for sender-mode. Bind host for the embedded mock receiver. Default `127.0.0.1`.
- `--mock-receiver-port <port>` — OPTIONAL for sender-mode. Bind port for the embedded mock receiver. Default `0` (OS-assigned).
- `--format <json|tap|junit>` — OPTIONAL. Output format. Default is human-readable text.
- `--now <ISO8601>` — OPTIONAL. Baseline timestamp for resolving `{{now±<duration>}}` templates in vectors.

The CLI MUST exit non-zero if any test fails against the target.

Exactly one of `--target` or `--sender-control` MUST be supplied. Specifying both is an error.

The **invocation mechanism**, **CLI command name**, and **distribution channel** remain PORT-SPECIFIC. The **flag set + semantics + exit-code rules + output formats** are CONTRACT (cross-port).

#### Scenario: Test failure exits non-zero

- **WHEN** any test in the suite fails against the target
- **THEN** the CLI exits with a non-zero status code
- **AND** the failing test's name, category, and the requirement it covers appear in the output

#### Scenario: JSON output is machine-readable

- **WHEN** the CLI is invoked with `--format json`
- **THEN** stdout is a single valid JSON document with per-test results, categories, and the requirement each test covers
- **AND** the document includes the suite version and the target URL (or sender-control URL)

#### Scenario: TAP and JUnit formats

- **WHEN** the CLI is invoked with `--format tap` or `--format junit`
- **THEN** stdout conforms to the respective format and is consumable by standard CI test reporters

#### Scenario: Runner errors when neither --target nor --sender-control is supplied

- **WHEN** the CLI is invoked without `--target` and without `--sender-control`
- **THEN** the CLI fails at flag parsing with a non-zero exit
- **AND** the error message names both flags and that exactly one is required

#### Scenario: Runner errors when both --target and --sender-control are supplied

- **WHEN** the CLI is invoked with both `--target <a>` and `--sender-control <b>`
- **THEN** the CLI fails at flag parsing with a non-zero exit
- **AND** the error message names that the two flags are mutually exclusive

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

The compliance suite (vectors + runner) SHALL be published as a `MAJOR.MINOR` version and carry **no PATCH component**; every `@postel/*` port shares that `MAJOR.MINOR` line and extends it with its own `PATCH`. "Lockstep" governs the version *numbers*, not release *timing*: a port at version `X.Y.Z` claims conformance by passing the compliance suite at version `X.Y` end-to-end before release. The port's `PATCH` (`Z`) is its own bugfix space — every `X.Y.Z` for a fixed `X.Y` conforms to the same suite `X.Y`, and the suite never publishes a patch of its own. The suite's distribution channel (npm package, container image, source build, binary release) is open and PORT-SPECIFIC; the version coordination is CONTRACT regardless of channel.

The compliance suite is the **leading edge**. A new requirement lands in the suite as a MINOR bump (`X.Y` → `X.(Y+1)`) first; each port adopts it on its own schedule and, when it does, releases a port version on the matching `MAJOR.MINOR`. During the `0.x` line, release timing is **independent per artifact**: the suite's latest version MAY be ahead of any given port's latest release (e.g., the suite at `0.3` while the newest TypeScript release is still `0.2.4`). A port is never required to move to a new suite MINOR at the same time as the suite; it is only required to pass `compliance@X.Y` whenever it releases an `X.Y.Z`.

At each **MAJOR boundary** (`1.0` and every major thereafter), the suite and all `@postel/*` ports cut the major **together** as a coordinated release — this is where VISION §8's "release together" rule applies. Within a major, the suite's MINOR bumps and each port's MINOR/PATCH releases ship independently per artifact under the leading-edge model above.

There is no ADVISORY phase, no runway window, and no independent per-port suite: the corpus at version `X.Y` is what every conformant port releasing on `X.Y` MUST satisfy. New tests land in the suite MINOR where they first appear and are required of any port releasing on that `MAJOR.MINOR` or later. Pre-1.0 (`0.x`) lives under VISION §8's experimental-semantics regime: suite MINORs MAY break ports, and the OpenSpec change history is the canonical record.

Breaking modifications and test removals follow the MAJOR-bump rule that governs every `@postel/*` package; the runway-based evolution model sketched in [ADR 0009](../../../decisions/0009-compliance-suite-evolution.md) remains **Deferred** until a second independently-maintained port makes graduated adoption valuable.

**Conformance**: the shared `MAJOR.MINOR` suite line, the suite's no-PATCH rule, the `X.Y` version-match (a port `X.Y.Z` passes `compliance@X.Y`), and the coordinated MAJOR cut are CONTRACT (cross-port). The independence of pre-1.0 release *timing*, each port's `PATCH` cadence, the CI mechanism a port uses to verify conformance, and the suite's distribution channel are PORT-SPECIFIC.

#### Scenario: The compliance suite is versioned MAJOR.MINOR with no patch

- **WHEN** the compliance suite is published
- **THEN** its version is a `MAJOR.MINOR` (e.g., `0.2`, `1.0`) with no PATCH component
- **AND** a suite-side fix MAY rewrite the same `MAJOR.MINOR` in place, or bump MINOR/MAJOR if the change warrants it; the suite never carries a PATCH

#### Scenario: A port owns its PATCH line within a conformance MINOR

- **WHEN** a port ships a bugfix that does not change its conformance target
- **THEN** it releases a new PATCH `X.Y.(Z+1)` that still conforms to `compliance@X.Y`
- **AND** no new compliance-suite version is published for the port's patch

#### Scenario: Pre-1.0, the suite leads and ports converge on their own schedule

- **WHEN** the compliance suite releases a `0.Y` MINOR carrying a new requirement
- **THEN** `@postel/*` ports are NOT required to move to `0.Y` at the same time
- **AND** the suite's latest version MAY be ahead of a port still releasing on `0.(Y-1)`
- **AND** any port that releases an `0.Y.Z` MUST pass `compliance@0.Y` end-to-end before release

#### Scenario: Major boundary is a coordinated cut

- **WHEN** the suite cuts a MAJOR release (`1.0` or any later major)
- **THEN** every `@postel/*` port releases that major together as a coordinated release
- **AND** each port at `MAJOR.0.0` passes `compliance@MAJOR.0` end-to-end before release

#### Scenario: New tests are required at the version they ship

- **WHEN** a new test vector lands in the suite as part of MINOR `X.Y`
- **THEN** every port releasing on `X.Y` (at or after that MINOR) MUST pass the new test
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

- **WHEN** a `0.x` suite MINOR introduces a behavior-changing test under the experimental-semantics regime
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

### Requirement: Out-of-scope behaviors at the current MINOR

Some CONTRACT requirements from capability specs SHALL be deferred from the current MINOR's corpus and land in a later MINOR (or MAJOR) when the architecture for testing them is decided. As of v0.2.0 the deferred set is:

- `sender` — Send participates in the host transaction (requires a host-DB hook; not trivially observable through the control plane), Send latency budget (perf benchmark harness), Worker throughput target (perf benchmark harness), Outbox poll latency (perf benchmark harness), DNS rebinding protection (the dispatcher validates resolved addresses but does not yet pin the connection to a checked IP).
- `filtering-transformation` — Late binding at dispatch time (the config-change-between-attempts vectors need a control-plane `update_endpoint` op and an executing sender-mode runner; the new-endpoint-after-send facet is already covered by `sender/fanout/late-binding-new-endpoint`), Transform produces body to send and Filter and transform errors fail closed (both are code-side host-callback behaviors — a transform/predicate is a function, not JSON, so they cannot be expressed over the HTTP control plane until a named-callback registration mechanism is designed; they remain CONTRACT and stay covered by each port's unit suite).
- `retry-policy` — Per-endpoint circuit breaker (full state-machine assertions land in v0.3 when an `attempt_status` history endpoint stabilizes), Endpoint auto-disable (full 24-hour-window assertions need a virtual-clock-driven driver protocol that lands in v0.3).
- `replay-reconciliation` — entire chapter deferred to v0.3.
- `multi-tenancy` — Per-tenant rate limits, Worker fairness across tenants, Tenant deletion cascades (full assertions need storage observability the control plane doesn't expose at v0.2).
- `observability` — entire chapter deferred.
- `standard-webhooks-compliance` — Wraps the official signing library (upstream-vector interop, easy v0.3 candidate), Versioning extension via `webhook-version` header (full sender-side emission test deferred to v0.3), IETF-alignment compatibility mode on the receiver.
- `key-management` — Encryption at rest with KMS adapter (library-API surface), Ephemeral keys via auto-rotation (full coverage).
- `storage-layer` — Postgres / SQLite adapter matrix CONTRACTs (gated by adapter packages, not in the v0.2 TS sender plan).

These tests SHALL land in subsequent MINOR (or MAJOR) releases. The current change does NOT prescribe their architecture.

#### Scenario: Deferred items documented in the changelog

- **WHEN** a port maintainer reads `compliance/CHANGELOG.md` for the current MINOR
- **THEN** the entry includes an explicit "Out of scope" section naming the deferred capabilities and the reason
- **AND** the entry indicates these are deferred to a later release, not removed

#### Scenario: A future MINOR brings a deferred item in scope

- **WHEN** a future MINOR's vectors cover one of the deferred items
- **THEN** the corresponding line in the `Out-of-scope behaviors at the current MINOR` body is removed in the same OpenSpec change that adds the vectors
- **AND** the CHANGELOG records both the addition and the now-in-scope notice

### Requirement: Sender-side compliance driver mechanism

Each `@postel/*` port that ships a sender SHALL expose an HTTP control-plane server (a "compliance driver") implementing the fixed route set below. The compliance runner drives the sender via this control plane, stands up an embedded mock receiver, and observes outgoing HTTP for assertion against `expected_requests`. The control-plane route set, request/response JSON shapes, and semantics are CONTRACT (cross-port). The bind host, port discovery, distribution channel, language, and lifecycle (subprocess, pre-running, container) are PORT-SPECIFIC.

The route set:

| Method + Path | Purpose | Request body | Response body |
|---|---|---|---|
| `GET /control/info` | Discovery: port info, suite-version compat | — | `{ port_name, port_version, suite_compat, mock_receiver_required }` |
| `POST /control/reset` | Wipe in-memory state between vectors | — | `{}` |
| `POST /control/endpoints` | Register a delivery endpoint | `{ url, types?, channels?, signing?: { fixture_id }, retryPolicy?, headers?, allowHttp?, tenantId?, as? }` | `{ endpointId }` |
| `POST /control/send` | Trigger `postel.send(...)` | `{ type, data?, channels?, idempotencyKey?, ttl?, tenantId? }` | `{ messageId }` |
| `POST /control/workers/start` | Start in-process workers | `{ concurrency? }` | `{}` |
| `POST /control/clock/advance` | Advance the sender's notion of "now" for retry-schedule vectors | `{ to_iso8601?, ms? }` | `{}` |

Optional debug-only routes (vector authoring aid; not required for CONTRACT-level passing): `GET /control/messages/:id`, `POST /control/keys/install`.

#### Scenario: Runner discovers port info via GET /control/info

- **WHEN** the runner issues `GET /control/info` against `--sender-control <url>`
- **THEN** the response is JSON with `port_name`, `port_version`, `suite_compat`, `mock_receiver_required`

#### Scenario: reset endpoint clears state between vectors

- **WHEN** the runner posts to `/control/reset` between vectors
- **THEN** the sender's in-memory state (endpoints, secrets, outbox, attempts) is returned to empty
- **AND** the next `/control/send` issues a fresh `MessageId`

#### Scenario: register_endpoint validates URL per endpoint-management

- **WHEN** the runner posts `/control/endpoints` with `{ url: "http://10.0.0.5/h", allowHttp: true }` and no `allowSsrf` override
- **THEN** the driver rejects with `4xx` and the error code surfaces as `ENDPOINT_VALIDATION`

#### Scenario: send returns a deterministic MessageId shape

- **WHEN** the runner posts `/control/send` with a minimal `{ type: "evt.ping" }`
- **THEN** the response carries `messageId` matching `^msg_[A-Za-z0-9]+$`

#### Scenario: clock advance is honored by retry scheduler

- **WHEN** the runner posts `/control/clock/advance` with `{ ms: 5000 }` after a failed first dispatch
- **THEN** the sender's virtual clock advances 5 s
- **AND** retry-schedule vectors observe the next dispatch arriving as if 5 s had elapsed

### Requirement: v0.2.0 sender-side initial test scope

The v0.2.0 corpus SHALL cover the following CONTRACT requirements via sender-mode vectors:

| Capability | Requirement |
|---|---|
| `sender` | Send is non-blocking and returns a SendResult |
| `sender` | Idempotent send by client-supplied key |
| `sender` | Late-binding fanout |
| `sender` | Per-message TTL |
| `sender` | Per-endpoint and overall delivery deadlines |
| `sender` | Per-endpoint custom HTTP headers |
| `sender` | SSRF protection on outbound delivery |
| `sender` | Attempt status enum casing |
| `retry-policy` | Default retry schedule with jitter |
| `retry-policy` | Programmable per-endpoint retry policy |
| `retry-policy` | Status-code-aware retry |
| `retry-policy` | Dead-letter event |
| `endpoint-management` | URL validation at create time |
| `endpoint-management` | Endpoint state machine with audit trail |
| `filtering-transformation` | Type filter with glob support |
| `filtering-transformation` | Channel filter |
| `standard-webhooks-compliance` | Compliant headers, signatures, payload structure, and prefixes by default |
| `multi-tenancy` | Tenant-scoped persistence |

The vector enumeration spans ~28 files across 10 sub-categories: `sender/wire-output/*` (4), `sender/idempotency/*` (2), `sender/fanout/*` (3), `sender/ttl/*` (2), `sender/retry-schedule/*` (4), `sender/deadlines/*` (2), `sender/ssrf-tls/*` (3), `sender/dead-letter/*` (2), `sender/filtering/*` (4), `sender/multi-tenancy/*` (2).

The `filtering-transformation` corpus covers the two filter shapes that the wire-driven control plane can express — type-glob and channel — each with a match and a no-match vector (`sender/filtering/{type-filter-glob-match,type-filter-glob-no-match,channel-filter-match,channel-filter-no-match}`). Three `filtering-transformation` CONTRACTs are intentionally NOT in this corpus and are deferred (see `Out-of-scope behaviors at the current MINOR`): "Late binding at dispatch time" needs a control-plane `update_endpoint` op (its new-endpoint facet stays covered by `sender/fanout/late-binding-new-endpoint`); "Transform produces body to send" and "Filter and transform errors fail closed" are code-side host-callback behaviors — a transform/predicate is a function, not JSON, so neither is expressible over the control plane — and stay covered by each port's unit suite. The contract-set table lists exactly the requirements some vector's `requirement` field names, so the enumeration scenario's union check holds.

#### Scenario: All v0.2.0 contracts and vectors enumerated

- **WHEN** the CLI is invoked with `--format json --sender-control <url>` and the suite is at version `0.2.x`
- **THEN** the output's test set matches the vector enumeration above (~28 vectors), no more and no less
- **AND** the union of the vectors' `requirement` fields equals the CONTRACT requirements in the contract-set table

#### Scenario: A port version v0.2.0 passes every sender vector

- **WHEN** the runner is pointed at a port's `@postel/compliance-driver`-equivalent at version `0.2.0`
- **THEN** every sender vector exits with `pass`
- **AND** any failure blocks the port's lockstep release per `Lockstep versioning with the @postel/* release train`

