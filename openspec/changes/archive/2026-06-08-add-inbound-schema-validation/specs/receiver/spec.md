## MODIFIED Requirements

### Requirement: Verify returns parsed event or structured error

The library SHALL expose `postel.verify(rawBody, headers, secretOrKeyset)` that, on success, returns the parsed Standard Webhooks event. On failure, it MUST throw a structured error indicating which step failed: one of `SIGNATURE_INVALID`, `TIMESTAMP_TOO_OLD`, `MALFORMED_HEADER`, `UNKNOWN_KEY_ID`, `RAW_BYTES_MISMATCH_DETECTED`, `EVENT_VALIDATION`. `EVENT_VALIDATION` is thrown only AFTER the signature check passes, when the inbound source declares a `schema` and the parsed `event.data` does not satisfy it.

#### Scenario: Successful verify

- **WHEN** the host calls `verify(rawBody, headers, secret)` with a valid signed payload
- **THEN** it returns the parsed event with `type`, `timestamp`, `data`

#### Scenario: Bad signature

- **WHEN** the signature header does not match the body
- **THEN** `verify` throws an error of class `SIGNATURE_INVALID`
- **AND** the error message names the failing step

#### Scenario: Schema validation failure

- **WHEN** the source declares a `schema` and the verified `event.data` does not satisfy it
- **THEN** `verify` throws an error of code `EVENT_VALIDATION`
- **AND** the failure occurs only after the signature check has passed

### Requirement: Framework adapters gate verification and map protocol errors to HTTP status

A framework adapter SHALL expose a verification **gate** — a framework-agnostic Web Fetch handler and each framework's native idiom (Express middleware, Fastify preHandler, Hono middleware, NestJS guard) — that runs `verify` against the raw request bytes BEFORE the adopter's handler executes. On success the gate SHALL pass control to the adopter's handler unchanged, attaching the parsed verification result to the framework's request context. On failure the gate SHALL short-circuit with an HTTP status determined by the failing `PostelError`'s stable `code`, per the canonical table:

| Error `code` | HTTP status |
|---|---|
| `SIGNATURE_INVALID` | 400 |
| `TIMESTAMP_TOO_OLD` | 400 |
| `MALFORMED_HEADER` | 400 |
| `RAW_BYTES_MISMATCH_DETECTED` | 400 |
| `UNKNOWN_KEY_ID` | 401 |
| `EVENT_VALIDATION` | 422 |

Errors that are NOT `PostelError` instances — including `NotImplementedError` — SHALL NOT be mapped to a 4xx. They SHALL propagate so the framework's error pipeline yields 5xx, per the `api-surface-typescript` implementation-state-error rule. The mapping is computed in one shared place (`@postel/http`) so every adapter resolves a given code identically.

**Conformance**: the status mapping and the "non-`PostelError` bubbles as 5xx" outcome are CONTRACT (wire-observable; the compliance suite asserts HTTP status). The gate *mechanism* per framework (middleware vs preHandler vs guard vs Fetch handler) is PORT-SPECIFIC — a port MAY bind the gate in whatever idiom its frameworks expect, provided the wire outcome matches.

#### Scenario: Bad signature maps to 400

- **WHEN** a request whose signature does not match the body hits a gate-protected route
- **THEN** the gate responds with HTTP 400
- **AND** the adopter's handler is not invoked

#### Scenario: Stale timestamp maps to 400

- **WHEN** the `webhook-timestamp` header is outside the tolerance window on a gate-protected route
- **THEN** the gate responds with HTTP 400 and the handler is not invoked

#### Scenario: Malformed header maps to 400

- **WHEN** a required signing header is absent or malformed on a gate-protected route
- **THEN** the gate responds with HTTP 400

#### Scenario: Unknown key id maps to 401

- **WHEN** the request's `kid` is absent from the configured keyset on a gate-protected route
- **THEN** the gate responds with HTTP 401

#### Scenario: Schema-invalid payload maps to 422

- **WHEN** a request verifies but its `event.data` fails the source's configured `schema`
- **THEN** the gate responds with HTTP 422
- **AND** the adopter's handler is not invoked

#### Scenario: Successful verification preserves the adopter handler

- **WHEN** verification succeeds on a gate-protected route
- **THEN** the adopter's own handler runs with the parsed verification result available on the request context
- **AND** the response is the handler's own response

#### Scenario: Non-PostelError bubbles as 5xx

- **WHEN** the gate's verification path throws a `NotImplementedError` (or any non-`PostelError`)
- **THEN** the gate does NOT map it to a 4xx
- **AND** it propagates so the framework surfaces it as a 5xx programming/version error
