# 0014 — Framework-adapter pattern: a framework-agnostic HTTP core + thin per-framework gate bindings

- **Status**: Accepted
- **Date**: 2026-06-02
- **Decision drivers**: avoid N adapters re-deriving the verify→HTTP policy; keep `@postel/core` pure; make the error→status mapping a single CONTRACT-testable surface; cross-port consistency for future Go/Python/Rust receivers

## Context

At the time of this decision the only real framework adapter is `@postel/hono`, and it is low-level: `postelHono(secretOrKeyset)` / `honoVerify(c, secretOrKeyset)` take a raw secret and call `verify()` directly, ignoring the configured `Postel({ inbound: {...} })` instance and leaving the read-bytes → verify → map-errors → dedup → ack loop for the adopter to hand-roll in every route. The remaining framework packages (`@postel/express`, `@postel/fastify`, `@postel/nextjs`, `@postel/bun`) are one-line stubs, and there is no NestJS adapter.

Postel is about to grow real adapters across Express, Fastify, Hono, and NestJS, plus an outbound admin router and JWKS publishing. If each adapter re-implements the verify-to-HTTP loop, three things go wrong: (1) the `PostelError`→HTTP-status table drifts between adapters; (2) the `api-surface-typescript` rule that implementation-state errors (`NotImplementedError`) must surface as 5xx, not 4xx, is easy to break per-adapter; and (3) the raw-bytes preservation contract is re-litigated in every package.

## Decision

Express the webhook HTTP surface **once** as a framework-agnostic core, and make every framework adapter a thin binding over it.

- A new package, **`@postel/http`**, owns: a normalized `handleInbound(source, { rawBody, headers, method }, opts) → WebhookOutcome` pipeline; a Web-Fetch `fetchWebhook(source, opts): (Request) => Promise<Response>` builder; a `@postel/http/node` entry (`writeOutcomeToNodeRes`, `headersFromNode`) for Node `req`/`res` frameworks; and the single canonical `PostelError`→HTTP-status policy (`statusForError` / `errorBody`).
- Each framework adapter binds the gate in its native idiom — Express middleware, Fastify preHandler, Hono middleware, NestJS guard — over `handleInbound`/`fetchWebhook`. The adopter keeps writing their own handler; the gate runs verification first, maps protocol errors to status, optionally dedup-acks, and stashes the verified result on the request context.
- `@postel/core` stays pure logic. The only HTTP-shaped thing it already ships (`jwksHandler`) stays; new HTTP gating lives in `@postel/http`.

This is the receiver-side analogue of the storage host-transaction passthrough (ADR 0007): one load-bearing pattern, many thin shims.

## Rationale

1. **One policy, defined once.** The error→status table is an exhaustive `Record<PostelErrorCode, number>` in `@postel/http` — a new code fails compilation until mapped. Every adapter resolves a given code identically, and `@postel/compliance` can assert the wire outcome once rather than per-adapter.
2. **The `instanceof PostelError` gate is correct by construction.** Because the pipeline only maps `PostelError` and rethrows everything else, `NotImplementedError` bubbles to a framework 5xx for free — the api-surface implementation-state-error rule holds in one place instead of N.
3. **Fetch is the universal currency.** Hono, Bun, Deno, and Next.js Route Handlers speak `Request`/`Response` natively, so `fetchWebhook` covers them with a one-line binding. Only Node-legacy (Express, Fastify) and DI (NestJS) frameworks need bespoke bridging, and they share `handleInbound` + the `@postel/http/node` writer.
4. **Core stays small.** HTTP gating is genuinely a transport concern. Keeping it out of `@postel/core` preserves the "import `verify`, pull in nothing else" tree-shaking guarantee.
5. **Cross-port generalization.** The CONTRACT is the wire outcome (status mapping, dedup-ack signal, byte preservation), not the `@postel/http` module. A future Go receiver reproduces the same outcome via `http.Handler`; Python via ASGI/WSGI. The pattern — framework-neutral core + idiomatic bindings — translates; the package does not have to.

## Decisions on the CONTRACT / PORT-SPECIFIC line

- **CONTRACT** (wire-observable; suite-gated): the `PostelError`→HTTP-status mapping, the "non-`PostelError` bubbles as 5xx" rule, raw-bytes preservation, and the dedup-ack signal (`2xx` + `X-Postel-Dedup-Result: duplicate`, verify-before-dedup ordering).
- **PORT-SPECIFIC** (mechanism): the gate *type* per framework (middleware vs preHandler vs guard vs Fetch handler), the `@postel/http` module shape, and the adapter-object ergonomics. These are documented in package READMEs and the docs site, not pinned cross-port.

## Consequences

- New package `@postel/http` (depends only on `@postel/core`), added to the `distribution-packaging-typescript` package map.
- The `receiver` capability gains two requirements: the verification-gate + error→status contract, and optional dedup-acknowledgement.
- Framework adapters (`@postel/hono` reworked; `@postel/express` / `@postel/fastify` made real; new `@postel/nestjs`) depend on `@postel/http` and stop carrying their own verify-to-HTTP logic.
- The existing `honoVerify` / `postelHono` secret-based helpers remain as `@deprecated` re-exports for the six-month deprecation window (`distribution-packaging-typescript`), so current adopters are not broken.

## Alternatives considered

### Put the gate logic in `@postel/core`

Rejected. It would grow core's surface with HTTP-shaped APIs and give the upcoming admin router no natural home. `jwksHandler` already living in core is a pragmatic exception, not a precedent to expand.

### Re-implement the gate in each framework package (no shared core)

Rejected. This is the status quo multiplied: the error→status table, dedup-ack, byte handling, and the `NotImplementedError`-bubbling rule would be duplicated across 4+ packages and drift. It also forces the compliance suite to assert the same wire behavior once per adapter.

### A callback-inversion API (`source.handler({ onEvent })` owning the route)

Rejected during planning as too intrusive: it dictates the handler's shape and return. The gate model (middleware/guard that runs before the adopter's own handler) is less intrusive and idiomatic to each framework, and the framework-agnostic `fetchWebhook` still serves Fetch-native runtimes for those who want a ready-made handler.
