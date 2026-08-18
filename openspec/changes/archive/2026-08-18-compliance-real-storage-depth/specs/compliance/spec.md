## MODIFIED Requirements

### Requirement: Vector file schema

Every test vector under `compliance/vectors/` SHALL be a YAML 1.2 file (safe subset) conforming to a shared schema. The on-disk format is YAML; the in-memory structure after parsing is what the schema validates and is identical to what an equivalent JSON file would produce. The schema is CONTRACT — every runner agrees on the format so vectors are portable across runners without translation.

A vector file SHALL declare the following fields:

- `id` — stable test identifier of the form `<category>/<vector-id>`.
- `requirement` — the CONTRACT requirement this vector covers, as `{ capability, title }`. Both fields verbatim-match a `### Requirement: <title>` block in `openspec/specs/<capability>/spec.md`.
- `description` — human-readable one-line summary.
- `mode` — OPTIONAL discriminator. Either `"receiver"` (default) or `"sender"`. Absent is equivalent to `"receiver"` to keep v0.1.0 vectors backward-compatible.
- **Receiver mode (`mode: "receiver"` or omitted)** — REQUIRED `input` and `signature_mode` fields as previously defined: `input.method`, `input.url`, `input.headers`, `input.body_b64`; `signature_mode` is `"static" | "computed"`; `secrets[]` references key fixtures. OPTIONAL `concurrency` (integer ≥ 2): when present, the runner fires the same signed `input` request `concurrency` times concurrently against the target and collects one observed verdict per response, instead of the single-request flow.
- **Sender mode (`mode: "sender"`)** — REQUIRED `triggers[]`, OPTIONAL `mock_receiver{}`, OPTIONAL `expected_requests[]`. `triggers[]` is an ordered list of control-plane operations: `register_endpoint`, `send`, `start_workers`, `advance_clock`, `wait_for`. `mock_receiver.scripted_responses[]` programs per-request HTTP responses from the embedded mock receiver. `expected_requests[]` is a length-exact list of asserted outgoing HTTP requests (matching headers, body, signature verification against a fixture, optional timing assertion via `arrived_within_ms`, optional `attempt_status` assertion read back via `/control/messages/:id`).
- `expected` — for sender vectors, `outcome: "accept"` means all expected_requests matched; `outcome: "reject"` means the control-plane call itself rejected (e.g., `EndpointValidation`); receiver-mode semantics are unchanged except for two additive, orthogonal fields:
  - `response_body_schema` — OPTIONAL, receiver mode only. An embedded JSON Schema (draft 2020-12 subset). When present, the runner parses the observed response body as JSON and validates it against this schema, independently of and in addition to the `outcome`/`error_code` verdict check. A vector MAY use this to assert response-body shape (e.g., "no field named `d` or `k` anywhere in this JWKS document") without inventing a bespoke verdict outcome for it.
  - `outcomes` — OPTIONAL, receiver mode only, REQUIRED (replacing `outcome`/`error_code`) exactly when the vector's top-level `concurrency` is set. An array of the same length as `concurrency`, naming the unordered multiset of verdict outcomes (`"accept" | "reject" | "duplicate"`, no `error_code`) the runner MUST observe across the `concurrency` concurrent responses, order-independent. This exists because some verdicts (e.g., dedup atomicity: "exactly one of two identical concurrent requests is a duplicate") are only meaningful under a genuine race, which a single `input`/`outcome` pair cannot express.

**YAML safe subset** unchanged.

**Time templating** — sender vectors MAY use `{{now±duration}}` templates inside trigger fields; resolved against `--now`. The `advance_clock` trigger drives the sender's virtual clock independently of `--now`.

**Signature material** — sender vectors with `signing: { fixture_id }` in a `register_endpoint` trigger have the runner load the fixture key from `compliance/vectors/_keys/<fixture>.yaml`, ship it to the sender via `/control/keys/install` or `register_endpoint` directly, and verify outgoing `webhook-signature` headers against the same fixture in `expected_requests[].signature_verifies`. A `concurrency`-bearing receiver-mode vector signs `input` once (same `webhook-id`/`webhook-timestamp`/body across all copies — the point is a true duplicate, not `concurrency` distinct messages) and replays the identical signed request `concurrency` times.

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

#### Scenario: response_body_schema validates the observed body independently of outcome

- **WHEN** a receiver-mode vector declares `expected.response_body_schema`
- **THEN** the runner parses the observed HTTP response body as JSON and validates it against the embedded schema
- **AND** the vector fails if either the `outcome`/`error_code` verdict mismatches OR the body fails schema validation, with both checks reported independently

#### Scenario: Concurrency fires the same signed request N times and checks the outcome multiset

- **WHEN** a receiver-mode vector declares `concurrency: 2` and `expected.outcomes: [accept, duplicate]`
- **THEN** the runner signs `input` once and sends it twice concurrently (not sequentially) against the target
- **AND** the vector passes if and only if the two observed outcomes, compared as an unordered multiset, equal `[accept, duplicate]`

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
- `storage-layer` — the full per-adapter *behavioral* vector matrix (fanout, retry, fairness, etc. re-run once per storage adapter) remains deferred, gated by adapter packages. **Partially in scope as of this change**: a CI-only tier runs the existing v0.2 sender corpus against `@postel/pg` (real Postgres via testcontainers) and asserts the resulting rows' column shape and enum-valued columns conform to `specs/db-schema/0001_init.sql` plus its migrations — proving the DB-schema half of AGENTS.md's cross-port claim for the TS port, without duplicating the whole behavioral corpus per adapter.

These tests SHALL land in subsequent MINOR (or MAJOR) releases. The current change does NOT prescribe their architecture.

#### Scenario: Deferred items documented in the changelog

- **WHEN** a port maintainer reads `compliance/CHANGELOG.md` for the current MINOR
- **THEN** the entry includes an explicit "Out of scope" section naming the deferred capabilities and the reason
- **AND** the entry indicates these are deferred to a later release, not removed

#### Scenario: A future MINOR brings a deferred item in scope

- **WHEN** a future MINOR's vectors cover one of the deferred items
- **THEN** the corresponding line in the `Out-of-scope behaviors at the current MINOR` body is removed in the same OpenSpec change that adds the vectors
- **AND** the CHANGELOG records both the addition and the now-in-scope notice

#### Scenario: Pg schema-conformance CI tier proves DB-schema shape, not adapter behavior

- **WHEN** the pg schema-conformance CI tier runs the sender corpus against `@postel/pg`
- **THEN** it asserts the shape of the resulting `tenants`, `endpoints`, `endpoint_secrets`, `messages`, `attempts`, `endpoint_state_transitions`, and `postel_received_messages` rows (column presence, enum-valued column vocabularies) against `specs/db-schema/`
- **AND** it does NOT assert per-adapter behavioral parity beyond what the existing sender corpus already exercises through the control plane — that full matrix stays in the deferred set above
