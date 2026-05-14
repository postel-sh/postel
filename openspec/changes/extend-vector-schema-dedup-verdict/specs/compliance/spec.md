## MODIFIED Requirements

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
