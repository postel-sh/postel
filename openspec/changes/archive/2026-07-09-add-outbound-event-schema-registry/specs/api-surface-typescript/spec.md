## ADDED Requirements

### Requirement: Outbound event schema registry

`createPostel`'s outbound config MAY declare `events`: a map from event `type` string literal to a schema implementing the [Standard Schema](https://github.com/standard-schema/standard-schema) v1 interface — the same interface `api-surface-typescript`'s "Per-source event schema validation" requirement already defines for inbound sources. `@postel/core` SHALL reuse the existing inlined Standard Schema v1 interface and SHALL NOT take a new runtime dependency.

When `outbound.events` registers a schema for a given `type`:

- `send()` SHALL validate `event.data` against it and SHALL throw `EventValidation` (code `EVENT_VALIDATION`) on mismatch — see `sender`.
- `send()`'s `TData` SHALL be inferred from the registered schema's output type when the call site's `type` is a literal matching a registered key, mirroring inbound's `EventOf<S>` inference.

When `type` does not match any registered key, `send()` behaves exactly as it does without a registry: no validation is attempted and `TData` defaults to `unknown`.

**Conformance**: the validation OUTCOME and the non-breaking fallback for unregistered types are CONTRACT, shared with `sender`. The registry config shape and the schema-output type inference are TypeScript-port mechanisms; other ports MAY surface per-type send validation through their own idioms.

#### Scenario: Registered event type is typed and validated

- **WHEN** `outbound.events` registers `"user.created": z.object({ id: z.string() })` and a caller invokes `postel.outbound.send({ type: "user.created", data })`
- **THEN** `data` is typed as `{ id: string }` at the call site
- **AND** `send()` validates `data` against the schema before persisting the outbox row

#### Scenario: Invalid data throws EventValidation before persistence

- **WHEN** `send()` is called with a registered `type` and `data` that does not satisfy its schema
- **THEN** `send()` throws `EventValidation` (code `EVENT_VALIDATION`) carrying the schema issues
- **AND** no outbox row is persisted for the rejected message

#### Scenario: Unregistered type stays permissive

- **WHEN** no schema is registered for the call site's `type`
- **THEN** `data` is typed `unknown` (or the caller's explicit `TData` generic) and no validation is attempted, identical to `send()`'s behavior with no `events` registry configured

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
| `RawBytesMismatchDetected` | `RAW_BYTES_MISMATCH_DETECTED` |
| `EventValidation` | `EVENT_VALIDATION` |
| `EndpointDisabled` | `ENDPOINT_DISABLED` |
| `EndpointNotFound` | `ENDPOINT_NOT_FOUND` |
| `IdempotencyKeyConflict` | `IDEMPOTENCY_KEY_CONFLICT` |
| `MigrationRequired` | `MIGRATION_REQUIRED` |
| `EndpointValidation` | `ENDPOINT_VALIDATION` |
| `SsrfBlocked` | `SSRF_BLOCKED` |

`EventValidation` additionally carries the failing schema's `issues` (a `ReadonlyArray<StandardSchemaV1.Issue>`). `EventValidation` is thrown from two sites — the receiver's `verify()` (per-source `schema` mismatch) and the sender's `send()` (per-type `events` registry mismatch, per `sender`'s "Per-type event schema validation on send") — with the same class and code in both directions.

Adding a new error class MUST add both names atomically. The `receiver` capability's error-code list and this table are synchronized — drift between the two is treated as a bug.

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
