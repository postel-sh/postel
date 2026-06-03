# receiver Specification

## Purpose

Receiver-side verification of incoming webhook deliveries: signature verification (multi-secret rotation window, JWKS consumer, constant-time comparison), structured `verify()` errors that name the failing step, raw-bytes preservation across framework middleware adapters, timestamp window enforcement against replay, and an idempotency dedup helper.
## Requirements
### Requirement: Verify returns parsed event or structured error

The library SHALL expose `postel.verify(rawBody, headers, secretOrKeyset)` that, on success, returns the parsed Standard Webhooks event. On failure, it MUST throw a structured error indicating which step failed: one of `SIGNATURE_INVALID`, `TIMESTAMP_TOO_OLD`, `MALFORMED_HEADER`, `UNKNOWN_KEY_ID`, `RAW_BYTES_MISMATCH_DETECTED`.

#### Scenario: Successful verify

- **WHEN** the host calls `verify(rawBody, headers, secret)` with a valid signed payload
- **THEN** it returns the parsed event with `type`, `timestamp`, `data`

#### Scenario: Bad signature

- **WHEN** the signature header does not match the body
- **THEN** `verify` throws an error of class `SIGNATURE_INVALID`
- **AND** the error message names the failing step

### Requirement: Framework adapters preserve raw bytes

The library SHALL provide middleware adapters for Express, Fastify, Koa, Hono, Elysia, `Bun.serve`, `Deno.serve`, Next.js Route Handlers, SvelteKit, Astro, and Nitro that preserve the raw request bytes passed to `verify`. JSON re-serialization MUST NOT happen between receipt and verification.

#### Scenario: Express adapter preserves bytes

- **WHEN** an Express route uses the Postel middleware
- **THEN** `verify` receives the exact bytes the receiver received, not a re-serialized JSON

### Requirement: Multi-secret window

`verify` SHALL accept an array of secrets and try each in order. The return value MUST indicate which secret matched so the caller can deprecate.

#### Scenario: Old secret matches

- **WHEN** `verify(body, headers, [newSecret, oldSecret])` is called and the signature was made with `oldSecret`
- **THEN** verification succeeds and the return value indicates `oldSecret` matched

### Requirement: Timestamp window enforcement

`verify` SHALL reject signatures whose `webhook-timestamp` header is older or further in the future than a configurable window (default 5 minutes per Standard Webhooks).

#### Scenario: Stale timestamp

- **WHEN** the `webhook-timestamp` header is 10 minutes old and the window is 5 minutes
- **THEN** `verify` throws `TIMESTAMP_TOO_OLD`

### Requirement: Idempotency dedup helper

The library SHALL provide `postel.dedup(messageId, { ttl })` returning `{ duplicate: boolean }` atomically (a second call within the TTL MUST return `{ duplicate: true }` even when the two calls race). First-party adapters MUST exist for **Postgres, SQLite, and in-memory**. An optional **Redis** adapter MAY be shipped for hosts that already run Redis — consistent with [ADR 0001 — Library shape](../../../decisions/0001-library-shape.md): Postel does NOT require Redis as a runtime dependency, but accommodates hosts that already have one.

#### Scenario: First receipt

- **WHEN** `dedup('msg_123', { ttl: '1h' })` is called for an unseen message id
- **THEN** the result is `{ duplicate: false }`
- **AND** the id is recorded for the TTL

#### Scenario: Duplicate receipt

- **WHEN** `dedup('msg_123', { ttl: '1h' })` is called twice within the TTL
- **THEN** the second call returns `{ duplicate: true }`

#### Scenario: Concurrent dedup calls

- **WHEN** two concurrent `dedup('msg_X')` calls arrive (no prior recording)
- **THEN** exactly one call returns `{ duplicate: false }`
- **AND** the other returns `{ duplicate: true }`

#### Scenario: Redis is opt-in only

- **WHEN** a host has NOT installed or configured the Redis dedup adapter
- **THEN** Postel runs without Redis as a dependency
- **AND** Postgres, SQLite, or in-memory dedup remains available

### Requirement: JWKS consumer

The library SHALL provide `createKeyset({ jwksUri, refreshEvery, cacheTtl })` that auto-fetches, caches, and rotates a JWKS, performs `kid` lookup on incoming requests, and is usable as the `secretOrKeyset` argument to `verify`.

#### Scenario: kid lookup hit

- **WHEN** an incoming request carries `webhook-id` with a known `kid` and the keyset has cached that key
- **THEN** verification proceeds against that key

### Requirement: Test fixtures for signed payloads

The library SHALL provide helpers to generate signed payloads in tests without invoking the real producer pipeline.

#### Scenario: Generate fixture

- **WHEN** a test calls `signFixture({ secret, payload })`
- **THEN** it returns headers and a body that `verify(body, headers, secret)` accepts

### Requirement: Constant-time signature comparison

All signature comparisons SHALL be constant-time. Implementations MUST NOT use `===` or other early-exit comparisons on signature material.

#### Scenario: Equal-length differing inputs take same time

- **WHEN** two equal-length signature buffers differ at byte 0 vs at the last byte
- **THEN** the comparison takes the same time (within measurement noise)

### Requirement: Verify latency budgets

`verify` SHALL run in ≤ 1 ms p99 for symmetric (HMAC) verification and ≤ 5 ms p99 for asymmetric (Ed25519) verification on reference hardware.

#### Scenario: Symmetric verify benchmark

- **WHEN** the receiver benchmark runs against a 1 KB payload with HMAC v1
- **THEN** the p99 latency is ≤ 1 ms

### Requirement: Replay-attack window enforcement

The receiver SHALL combine timestamp window enforcement with optional dedup to defend against replay attacks. Operators MUST be able to enable both with one-line configuration.
\
#### Scenario: Replayed signed request

- **WHEN** an attacker replays a previously valid request 10 minutes later
- **THEN** the timestamp window rejects the request

### Requirement: No payload contents in logs by default

The receiver SHALL elide payload bodies from default logging. Enabling body logging MUST require an explicit configuration flag.

#### Scenario: Default logs

- **WHEN** `verify` succeeds and default logging is on
- **THEN** the log line contains the message id and event type but NOT the payload body

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

