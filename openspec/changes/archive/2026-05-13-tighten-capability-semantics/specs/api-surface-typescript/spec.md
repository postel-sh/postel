# api-surface-typescript — delta spec

## MODIFIED Requirements

### Requirement: Structured error classes

Every public failure mode SHALL throw a typed error class derived from `PostelError`. Each subclass MUST have:

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
