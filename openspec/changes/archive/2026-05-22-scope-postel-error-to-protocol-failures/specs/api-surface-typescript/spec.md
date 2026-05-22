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
| `EndpointDisabled` | `ENDPOINT_DISABLED` |
| `IdempotencyKeyConflict` | `IDEMPOTENCY_KEY_CONFLICT` |
| `MigrationRequired` | `MIGRATION_REQUIRED` |
| `EndpointValidation` | `ENDPOINT_VALIDATION` |
| `SsrfBlocked` | `SSRF_BLOCKED` |

Adding a new error class MUST add both names atomically. The `receiver` capability's error-code list and this table are synchronized — drift between the two is treated as a bug.

**Implementation-state errors are intentionally outside the `PostelError` hierarchy.** Errors that describe library state rather than webhook semantics — e.g., `NotImplementedError`, thrown when a port version exposes a typed method whose runtime has not yet shipped — describe a *different category* of failure than webhook-protocol outcomes. Adopters who write the natural pattern `if (err instanceof PostelError) return 4xx` are translating webhook-protocol failures into HTTP responses; that pattern MUST NOT accidentally catch implementation-state errors and convert them into HTTP 4xx, because library-state failures are programming/version errors that should bubble as 5xx (or fail-fast in development). Implementation-state errors SHALL therefore extend the platform `Error` class directly and SHALL carry a stable `code` property (e.g., `code: 'NOT_IMPLEMENTED'`) for adopters who explicitly want to discriminate them, but they SHALL NOT extend `PostelError` and their codes SHALL NOT appear in the `PostelErrorCode` union.

#### Scenario: instanceof discrimination

- **WHEN** a consumer wraps `verify(...)` in try/catch and inspects the error
- **THEN** `err instanceof SignatureInvalid` correctly identifies signature failures

#### Scenario: code property discrimination

- **WHEN** a consumer reads `err.code` on a thrown error of class `SignatureInvalid`
- **THEN** the value is the stable string `'SIGNATURE_INVALID'`

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
