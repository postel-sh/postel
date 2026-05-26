## ADDED Requirements

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
| `sender` | Send is non-blocking and returns a MessageId |
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
| `filtering-transformation` | Transform produces body to send |
| `filtering-transformation` | Filter and transform errors fail closed |
| `filtering-transformation` | Late binding at dispatch time |
| `standard-webhooks-compliance` | Compliant headers, signatures, payload structure, and prefixes by default |
| `multi-tenancy` | Tenant-scoped persistence |

The vector enumeration spans ~30 files across 11 sub-categories: `sender/wire-output/*` (4), `sender/idempotency/*` (2), `sender/fanout/*` (3), `sender/ttl/*` (2), `sender/retry-schedule/*` (4), `sender/deadlines/*` (2), `sender/ssrf-tls/*` (3), `sender/dead-letter/*` (2), `sender/filtering/*` (4), `sender/late-binding/*` (2), `sender/multi-tenancy/*` (2).

#### Scenario: All v0.2.0 contracts and vectors enumerated

- **WHEN** the CLI is invoked with `--format json --sender-control <url>` and the suite is at version `0.2.x`
- **THEN** the output's test set matches the vector enumeration above (~30 vectors), no more and no less
- **AND** the union of the vectors' `requirement` fields equals the CONTRACT requirements in the contract-set table

#### Scenario: A port version v0.2.0 passes every sender vector

- **WHEN** the runner is pointed at a port's `@postel/compliance-driver`-equivalent at version `0.2.0`
- **THEN** every sender vector exits with `pass`
- **AND** any failure blocks the port's lockstep release per `Lockstep versioning with the @postel/* release train`

## MODIFIED Requirements

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

## RENAMED Requirements

- FROM: `### Requirement: v0.1.0 explicit out-of-scope — sender-side behavior`
- TO: `### Requirement: Out-of-scope behaviors at the current MINOR`

### Requirement: Out-of-scope behaviors at the current MINOR

Some CONTRACT requirements from capability specs are deferred from the current MINOR's corpus and shall land in a later MINOR (or MAJOR) when the architecture for testing them is decided. As of v0.2.0 the deferred set is:

- `sender` — Send participates in the host transaction (requires a host-DB hook; not trivially observable through the control plane), Send latency budget (perf benchmark harness), Worker throughput target (perf benchmark harness), Outbox poll latency (perf benchmark harness).
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
