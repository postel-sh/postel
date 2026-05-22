## MODIFIED Requirements

### Requirement: Public function signatures match Standard Webhooks event shape

The TS API SHALL accept and produce events shaped as `{ type, timestamp?, data?, channels?, version? }`. Only `type` is required; `timestamp`, `data`, `channels`, and `version` are optional. Standard Webhooks carries the canonical message timestamp on the `webhook-timestamp` HTTP header — an event body MAY include a `timestamp` field as a host-side convention but is not required to. `data` is optional for events with no payload (e.g., a `user.deleted` event where the receiver identifies the user from headers or message id alone). Type definitions MUST flow through to consumers without `any`.

#### Scenario: Strongly-typed event

- **WHEN** a consumer calls `postel.outbound.send<OrderCreated>({ type: 'order.created', data: {...} })`
- **THEN** TypeScript infers the `data` shape from the `OrderCreated` generic

#### Scenario: Event with only the required `type` field

- **WHEN** a consumer calls `postel.outbound.send({ type: 'user.deleted' })` with no `data`, `timestamp`, `channels`, or `version`
- **THEN** the call is well-typed and accepted; no field beyond `type` is mandated by the library's public types

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
| `NotImplementedError` | `NOT_IMPLEMENTED` |

Adding a new error class MUST add both names atomically. The `receiver` capability's error-code list and this table are synchronized — drift between the two is treated as a bug.

`NOT_IMPLEMENTED` is an **implementation-state** code rather than a webhook-protocol code: it is thrown when a typed method exists on the public surface but the runtime for that method has not yet landed in the current port version (e.g., `postel.outbound.send` in `@postel/core` v0.x before the sender runtime ships). Ports SHALL throw `NotImplementedError` rather than a generic `Error` so consumers can discriminate uniformly across all public failure modes.

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

#### Scenario: NotImplementedError participates in the PostelError hierarchy

- **WHEN** a consumer calls a typed method whose runtime has not yet landed in the current port version (e.g., `postel.outbound.send(...)` in `@postel/core` v0.x)
- **THEN** the call throws a `NotImplementedError` that is `instanceof PostelError`
- **AND** `err.code === 'NOT_IMPLEMENTED'`
