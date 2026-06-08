## ADDED Requirements

### Requirement: Per-source event schema validation

An inbound source MAY declare a `schema` implementing the [Standard Schema](https://github.com/standard-schema/standard-schema) v1 interface (e.g. a zod ≥3.24 schema, valibot, or arktype) that describes the event `data` payload. `@postel/core` SHALL inline the Standard Schema v1 interface and SHALL NOT take a runtime dependency on any schema library, preserving its zero-runtime-dependency guarantee per `distribution-packaging-typescript`.

When a source declares a `schema`:

- `verify()` SHALL validate the parsed `event.data` against it AFTER the signature check, and SHALL throw `EventValidation` (code `EVENT_VALIDATION`) on mismatch — see `receiver`.
- The verified result's `TData` SHALL be inferred from the schema's output type through `const` config inference, so `postel.inbound.<source>.verify(...)` and the framework adapters' typed handlers carry the payload type without a wrapper.

When a source declares no `schema`, `verify()` behaves unchanged and the result's `TData` is `unknown`.

**Conformance**: the validation OUTCOME (throw `EVENT_VALIDATION` on mismatch, pass through otherwise) is CONTRACT and shared with `receiver`. The Standard Schema interface and the schema-output type inference are TypeScript-port mechanisms; other ports MAY surface per-source payload validation through their own idioms.

#### Scenario: Schema output flows to the verified result type

- **WHEN** a source configures `schema: z.object({ id: z.string() })` and a caller awaits `postel.inbound.<source>.verify(body, headers)`
- **THEN** the result's `event.data` is typed as `{ id: string }`, not `unknown`

#### Scenario: Invalid payload throws EventValidation

- **WHEN** a verified request's `event.data` does not satisfy the source's `schema`
- **THEN** `verify()` throws `EventValidation` (code `EVENT_VALIDATION`) carrying the schema issues

#### Scenario: No schema leaves behavior unchanged

- **WHEN** a source declares no `schema`
- **THEN** `verify()` returns the parsed event unchanged and the result's `event.data` is typed `unknown`

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

`EventValidation` additionally carries the failing schema's `issues` (a `ReadonlyArray<StandardSchemaV1.Issue>`).

Adding a new error class MUST add both names atomically. The `receiver` capability's error-code list and this table are synchronized — drift between the two is treated as a bug.

**Implementation-state errors are intentionally outside the `PostelError` hierarchy.** Errors that describe library state rather than webhook semantics — e.g., `NotImplementedError`, thrown when a port version exposes a typed method whose runtime has not yet shipped — describe a *different category* of failure than webhook-protocol outcomes. Adopters who write the natural pattern `if (err instanceof PostelError) return 4xx` are translating webhook-protocol failures into HTTP responses; that pattern MUST NOT accidentally catch implementation-state errors and convert them into HTTP 4xx, because library-state failures are programming/version errors that should bubble as 5xx (or fail-fast in development). Implementation-state errors SHALL therefore extend the platform `Error` class directly and SHALL carry a stable `code` property (e.g., `code: 'NOT_IMPLEMENTED'`) for adopters who explicitly want to discriminate them, but they SHALL NOT extend `PostelError` and their codes SHALL NOT appear in the `PostelErrorCode` union.

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
