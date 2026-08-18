## MODIFIED Requirements

### Requirement: Structured error classes

Every public failure mode representing a **webhook-protocol or wire-format outcome** SHALL throw a typed error class derived from `PostelError`. Each `PostelError` subclass MUST have:

- A **PascalCase class name** (TypeScript-idiomatic).
- A stable **`code` property** in SCREAMING_SNAKE_CASE that matches the corresponding error code documented in `receiver` (so the codes are consumable from contexts that don't have access to the class hierarchy — e.g., admin handler JSON payloads, cross-port port API audits, log correlation).
- Discoverable via `instanceof` AND via `err.code === 'X'` checks.

The canonical class ↔ code mapping is:

| Class | `.code` |
|---|---|
| `SignatureInvalid` | `SIGNATURE_INVALID` |
| `TimestampTooOld` | `TIMESTAMP_TOO_OLD` |
| `MalformedHeader` | `MALFORMED_HEADER` |
| `UnknownKeyId` | `UNKNOWN_KEY_ID` |
| `EventValidation` | `EVENT_VALIDATION` |
| `EndpointDisabled` | `ENDPOINT_DISABLED` |
| `EndpointNotFound` | `ENDPOINT_NOT_FOUND` |
| `MigrationRequired` | `MIGRATION_REQUIRED` |
| `EndpointValidation` | `ENDPOINT_VALIDATION` |
| `SsrfBlocked` | `SSRF_BLOCKED` |

`EventValidation` additionally carries the failing schema's `issues` (a `ReadonlyArray<StandardSchemaV1.Issue>`). `EventValidation` is thrown from two sites — the receiver's `verify()` (per-source `schema` mismatch) and the sender's `send()` (per-type `events` registry mismatch, per `sender`'s "Per-type event schema validation on send") — with the same class and code in both directions.

Adding a new error class MUST add both names atomically, and only for a failure mode the runtime actually produces — a class with no throw site is dead surface, not a forward-declared contract. The `receiver` capability's error-code list and this table are synchronized — drift between the two is treated as a bug.

**Implementation-state errors are intentionally outside the `PostelError` hierarchy.** Errors that describe library state rather than webhook semantics — e.g., `NotImplementedError`, thrown when a port version exposes a typed method whose runtime has not yet shipped — describe a *different category* of failure than webhook-protocol outcomes. Adopters who write the natural pattern `if (err instanceof PostelError) return 4xx` are translating webhook-protocol failures into HTTP responses; that pattern MUST NOT accidentally catch implementation-state errors and convert them into HTTP 4xx, because library-state failures are programming/version errors that should bubble as 5xx (or fail-fast in development). Implementation-state errors SHALL therefore extend the platform `Error` class directly and SHALL carry a stable `code` property (e.g., `code: 'NOT_IMPLEMENTED'`) for adopters who explicitly want to discriminate them, but they SHALL NOT extend `PostelError` and their codes SHALL NOT appear in the `PostelErrorCode` union.

**Configuration errors are likewise outside the `PostelError` hierarchy.** A mistake in developer-supplied configuration or library usage — an inbound source configured with no verifiers, `dedup()` invoked without a ttl, an unparsable ttl value, an empty secret array, a `secretOrKeyset` that is not a string / string array / Keyset, a receiver-side secret carrying the ed25519-private prefix, `createKeyset` in a runtime with no `fetch`, or `signFixture` with an unsupported secret kind — is an integrator bug, not a wire-format outcome, and SHALL throw `ConfigurationError`. `ConfigurationError` SHALL extend the platform `Error` class directly, SHALL carry `name = 'ConfigurationError'` and a stable `code = 'CONFIGURATION_ERROR'`, SHALL NOT extend `PostelError`, and its code SHALL NOT appear in the `PostelErrorCode` union — so the `if (err instanceof PostelError) return 4xx` pattern and the `PostelErrorCode`-keyed status maps in `@postel/http` and `@postel/admin` never translate a configuration bug into a client error; it bubbles as a 5xx (or fail-fast in development). Wire-format failures — missing or unparsable signing headers, malformed signature tuples, malformed event envelopes, malformed JWKS documents, and failed runtime JWKS fetches — remain `MalformedHeader`.

#### Scenario: instanceof discrimination

- **WHEN** a consumer wraps `verify(...)` in try/catch and inspects the error
- **THEN** `err instanceof SignatureInvalid` correctly identifies signature failures

#### Scenario: code property discrimination

- **WHEN** a consumer reads `err.code` on a thrown error of class `SignatureInvalid`
- **THEN** the value is the stable string `'SIGNATURE_INVALID'`

#### Scenario: EventValidation discrimination

- **WHEN** a verified payload fails its source's `schema`
- **THEN** the thrown error satisfies `err instanceof EventValidation` AND `err.code === 'EVENT_VALIDATION'`
- **AND** `err.issues` lists the schema validation issues

#### Scenario: EventValidation on the send path uses the same class and code

- **WHEN** `send()` rejects a message because its `data` fails the registered schema for its `type`
- **THEN** the thrown error satisfies `err instanceof EventValidation` AND `err.code === 'EVENT_VALIDATION'`
- **AND** `err.issues` lists the schema validation issues, identical in shape to the receiver-side throw

#### Scenario: Cross-port code parity

- **WHEN** the equivalent Go / Python / Rust port produces an error for the same failure mode
- **THEN** the error carries the same SCREAMING_SNAKE code (`'SIGNATURE_INVALID'`)
- **AND** consumers can match on `code` across language boundaries via JSON payloads

#### Scenario: Implementation-state errors are not PostelError

- **WHEN** a consumer calls a typed method whose runtime has not yet landed in the current port version (e.g., `postel.outbound.send(...)` in `@postel/core` v0.x)
- **THEN** the call throws a `NotImplementedError`
- **AND** `err instanceof NotImplementedError` is true
- **AND** `err instanceof Error` is true
- **AND** `err instanceof PostelError` is **false**
- **AND** `err.code === 'NOT_IMPLEMENTED'` for explicit discrimination
- **AND** the typical adopter catch pattern `if (err instanceof PostelError) return 4xx` does NOT match, so the error bubbles as a programming/version issue rather than being misclassified as a webhook-protocol failure

#### Scenario: Configuration errors are not PostelError

- **WHEN** a consumer misuses the library's configuration surface (e.g., calls `verify(rawBody, headers, [])` with an empty secret array, or `inbound.<source>.dedup(id)` with no ttl configured or supplied)
- **THEN** the call throws a `ConfigurationError`
- **AND** `err instanceof ConfigurationError` is true
- **AND** `err instanceof Error` is true
- **AND** `err instanceof PostelError` is **false**
- **AND** `err.code === 'CONFIGURATION_ERROR'` for explicit discrimination

#### Scenario: Configuration mistakes are not misclassified as wire errors

- **WHEN** a developer-configuration mistake (empty secret array, missing dedup ttl, non-Keyset `secretOrKeyset`, ed25519-private receiver secret, unparsable ttl, missing runtime `fetch`, unsupported `signFixture` secret) triggers a throw
- **THEN** the thrown error is `ConfigurationError`, not `MalformedHeader`
- **AND** the `PostelErrorCode`-keyed HTTP status mapping does not resolve a status for it, so an admin or gate handler surfaces it on its 500/throw path rather than as a 400

### Requirement: Unimplemented config slots fail fast at construction [PORT-SPECIFIC]

A config slot whose type exists on the public surface but whose runtime has not yet shipped SHALL reject configuration at construction time by throwing `NotImplementedError`, rather than accepting the value and silently never honoring it. The factory MUST NOT downgrade to a different behavior (e.g. plaintext storage when a KMS adapter was requested) without a signal. This generalizes the existing `workers` behavior — only the `in-process` strategy ships, and configuring `bullmq` / `pg-boss` / `external` throws — to every typed-but-unshipped slot.

The slots that fail fast in the current TypeScript port are:

- `outbound.workers` set to `BullMQ(...)`, `PgBoss(...)`, or `External(...)`. `InProcess(...)` is the only shipped worker runtime.
- `outbound.kms` set to a built-in KMS adapter (`aws-kms`, `gcp-kms`, `vault`). `PlaintextKms` is accepted (it is the shipped storage behavior, explicitly opted into).
- `outbound.retention`.
- `outbound.ephemeralKeys`.
- `outbound.http.tls` and per-endpoint `http.tls` (the TLS-verification opt-out is not wired; TLS-on remains the runtime default).
- `outbound.http.dns` and per-endpoint `http.dns` (DNS-resolution pinning is not wired).
- `endpoints.create` / `endpoints.update` `maxInflight`. The field is accepted, typed, and persisted on the endpoint record, but no dispatcher or worker reads it — until a per-endpoint concurrency cap ships, configuring it fails fast rather than silently admitting unbounded concurrent deliveries.

`NotImplementedError` is an implementation-state error (code `NOT_IMPLEMENTED`), not a `PostelError` — see *Structured error classes*. The capability of record for each slot (key-management, observability, sender) keeps its eventual contract; this requirement owns only the interim construction-time behavior.

**Conformance**: PORT-SPECIFIC. The OUTCOME — a configured-but-unimplemented feature never silently no-ops — is the cross-port intent, but the mechanism (throwing `NotImplementedError` at construction, the exact slot set, and which slots have shipped) is reference-implementation state. Other ports fail fast through their own idioms and on their own per-slot schedule. The compliance suite does not exercise unimplemented slots.

#### Scenario: Non-in-process worker strategies fail fast

- **WHEN** a caller constructs `Postel({ outbound: { storage, workers: BullMQ(queue) } })`, `Postel({ outbound: { storage, workers: PgBoss(boss) } })`, or `Postel({ outbound: { storage, workers: External(adapter) } })`
- **THEN** construction throws `NotImplementedError` for all three
- **AND** `err.code === 'NOT_IMPLEMENTED'`
- **AND** no queue/adapter code path is silently exercised in-process instead

#### Scenario: Built-in KMS adapter fails fast

- **WHEN** a caller constructs `Postel({ outbound: { storage, kms: AwsKms({ keyId }) } })` (or `GcpKms` / `Vault`)
- **THEN** construction throws `NotImplementedError`
- **AND** `err.code === 'NOT_IMPLEMENTED'`
- **AND** no endpoint secret is ever written in plaintext under the assumption that KMS was active

#### Scenario: PlaintextKms and a fully-wired config construct without throwing

- **WHEN** a caller constructs `Postel({ outbound: { storage, kms: PlaintextKms() } })`, or omits `kms` entirely
- **THEN** construction succeeds
- **AND** the same holds for a config that sets only wired slots (`signing`, `retryPolicy`, `workers: InProcess(...)`, `circuitBreaker`, `autoDisable`, `replay`, `http.{requestTimeout,overallDeadline,ssrf,userAgent,fetch}`)

#### Scenario: Retention and ephemeral-keys slots fail fast

- **WHEN** a caller constructs `Postel({ outbound: { storage, retention: { attempts: '30d' } } })`, or sets `ephemeralKeys: { rotateEvery: '12h' }`
- **THEN** construction throws `NotImplementedError`

#### Scenario: Unwired HTTP security knobs fail fast

- **WHEN** a caller sets `outbound.http.tls` (e.g. `{ verify: false }`) or `outbound.http.dns` (e.g. `{ pinResolution: true }`), at the org level or as a per-endpoint `http` override on `endpoints.create` / `endpoints.update`
- **THEN** the call throws `NotImplementedError`

#### Scenario: Endpoint maxInflight fails fast

- **WHEN** a caller calls `endpoints.create({ url, maxInflight: 5 })` or `endpoints.update(id, { maxInflight: 5 })`
- **THEN** the call throws `NotImplementedError`
- **AND** no endpoint row is created or patched with a `maxInflight` value the runtime would silently ignore
