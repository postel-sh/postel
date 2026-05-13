# receiver Specification

## Purpose

Receiver-side verification of incoming webhook deliveries: signature verification (multi-secret rotation window, JWKS consumer, constant-time comparison), structured `verify()` errors that name the failing step, raw-bytes preservation across framework middleware adapters, timestamp window enforcement against replay, and an idempotency dedup helper. Designed to run unmodified on edge runtimes within a 50 KB minified+gzipped bundle.
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

### Requirement: Edge bundle size budget

The receiver-only build (`@postel/edge`) SHALL be ≤ 50 KB minified+gzipped. CI MUST fail the build if this budget is exceeded.

#### Scenario: Bundle size enforced in CI

- **WHEN** a change increases `@postel/edge` to 55 KB minified+gzipped
- **THEN** the CI check fails with a clear message

### Requirement: Edge runtime portability

`@postel/edge` SHALL run unmodified on Cloudflare Workers, Vercel Edge, Deno Deploy, Bun, and Cloudflare Pages. It MUST use Web Crypto only and MUST NOT import any `node:*` module.

#### Scenario: Cloudflare Workers smoke test

- **WHEN** `@postel/edge` is deployed to a Cloudflare Worker
- **THEN** `verify` against a valid signed payload returns the parsed event without polyfills

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

