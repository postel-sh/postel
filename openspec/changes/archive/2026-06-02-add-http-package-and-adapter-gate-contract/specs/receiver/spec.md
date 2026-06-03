## ADDED Requirements

### Requirement: Framework adapters gate verification and map protocol errors to HTTP status

A framework adapter SHALL expose a verification **gate** — a framework-agnostic Web Fetch handler and each framework's native idiom (Express middleware, Fastify preHandler, Hono middleware, NestJS guard) — that runs `verify` against the raw request bytes BEFORE the adopter's handler executes. On success the gate SHALL pass control to the adopter's handler unchanged, attaching the parsed verification result to the framework's request context. On failure the gate SHALL short-circuit with an HTTP status determined by the failing `PostelError`'s stable `code`, per the canonical table:

| Error `code` | HTTP status |
|---|---|
| `SIGNATURE_INVALID` | 400 |
| `TIMESTAMP_TOO_OLD` | 400 |
| `MALFORMED_HEADER` | 400 |
| `RAW_BYTES_MISMATCH_DETECTED` | 400 |
| `UNKNOWN_KEY_ID` | 401 |

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

#### Scenario: Successful verification preserves the adopter handler

- **WHEN** verification succeeds on a gate-protected route
- **THEN** the adopter's own handler runs with the parsed verification result available on the request context
- **AND** the response is the handler's own response

#### Scenario: Non-PostelError bubbles as 5xx

- **WHEN** the gate's verification path throws a `NotImplementedError` (or any non-`PostelError`)
- **THEN** the gate does NOT map it to a 4xx
- **AND** it propagates so the framework surfaces it as a 5xx programming/version error

### Requirement: Framework adapters offer optional dedup-acknowledgement

A framework gate MAY be configured to acknowledge duplicates using the source's configured dedup adapter. When enabled, the gate SHALL verify the request FIRST, then look up `dedup(messageId)` keyed on the `webhook-id`; if the id has been recorded within the TTL, the gate SHALL respond `2xx` with the header `X-Postel-Dedup-Result: duplicate` and SHALL NOT invoke the adopter's handler. On first receipt the gate MUST NOT set that header and MUST invoke the handler. When no dedup is configured the gate SHALL be a pass-through — every verified request reaches the handler. Dedup SHALL run only AFTER successful verification, so an unauthenticated `webhook-id` can never short-circuit handling.

**Conformance**: the `2xx` + `X-Postel-Dedup-Result: duplicate` signal and the verify-before-dedup ordering are CONTRACT; the dedup storage backend remains PORT-SPECIFIC via the dedup adapter.

#### Scenario: First receipt invokes the handler

- **WHEN** a gate with dedup enabled sees a fresh `webhook-id`
- **THEN** the adopter's handler runs
- **AND** no `X-Postel-Dedup-Result` header is set

#### Scenario: Duplicate receipt is acknowledged without invoking the handler

- **WHEN** the same `webhook-id` arrives a second time within the TTL on a dedup-enabled gate
- **THEN** the gate responds `2xx` with `X-Postel-Dedup-Result: duplicate`
- **AND** the adopter's handler does not run

#### Scenario: Dedup disabled is a pass-through

- **WHEN** no dedup adapter is configured on the gate
- **THEN** every verified request reaches the handler regardless of `webhook-id` repetition

#### Scenario: Dedup runs only after verification

- **WHEN** a request that fails verification arrives on a dedup-enabled gate
- **THEN** the gate rejects it with the mapped 4xx status
- **AND** the dedup adapter is never consulted for that request
