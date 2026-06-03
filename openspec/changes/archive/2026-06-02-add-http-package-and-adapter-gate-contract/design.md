# Design — framework-agnostic webhook HTTP core

## Context

`@postel/hono` is the only real adapter and it is low-level: it calls `verify()` with a raw secret and leaves read-bytes / error-mapping / dedup / ack to the adopter. The remaining adapters are stubs. Postel is about to grow adapters for Express, Fastify, and NestJS, plus an outbound admin router and JWKS publishing. If each adapter re-implements the verify→map→ack loop, the `PostelError`→HTTP-status table drifts and the api-surface rule (implementation-state errors must be 5xx, not 4xx) is easy to break per-adapter.

## Goals / Non-Goals

**Goals**
- One place that turns "a configured inbound source + a request" into an HTTP outcome, with the error→status policy defined once.
- A Web-Fetch handler usable directly by Fetch-native runtimes, and a Node `req`/`res` writer for legacy frameworks — both over the same pipeline.
- Keep `@postel/core` pure logic (no growth of its HTTP surface beyond the existing `jwksHandler`).

**Non-Goals**
- The per-framework bindings (Hono middleware, Express middleware, Fastify preHandler, NestJS guard) — those land in their own adapter PRs on top of this core.
- The admin router and JWKS publishing — separate PRs; same pattern.

## Decisions

- **Handler home = a new `@postel/http` package, not `@postel/core`.** The pipeline is HTTP-shaped; core stays the pure verify/sign/dedup/sender library. `@postel/http` depends only on `@postel/core`. (Alternative: put it in core alongside `jwksHandler` — rejected to avoid growing core's surface and to give the admin router / future HTTP concerns a clear home.)
- **A normalized outcome (`handleInbound`) is the primitive; `fetchWebhook` is a thin Response-adapter over it.** Node frameworks call `handleInbound` directly and write `res` — they do NOT synthesize a Web `Request` from the Node stream (that bridge needs `duplex: 'half'` and risks the raw-bytes contract). This keeps byte fidelity and avoids a stream polyfill in Node bundles.
- **Verify FIRST, then dedup.** Dedup-ack is opt-in and never short-circuits before verification, so an unauthenticated `webhook-id` cannot be used to probe or suppress handling. On a confirmed duplicate the gate returns `2xx` + `X-Postel-Dedup-Result: duplicate` (the signal the compliance suite already pins) and skips the handler.
- **Error→status is an exhaustive `Record<PostelErrorCode, number>`.** Adding a new code to the union fails compilation here until it is mapped — the spec-drift guard lives in the type system. Non-`PostelError` (incl. `NotImplementedError`) is never mapped; the `instanceof PostelError` gate lets it propagate to a framework 5xx for free.
- **The `webhook-id` reader is re-implemented locally.** `ID_HEADER`/`requireHeader` are internal to `@postel/core` (no internal barrel exports), so `@postel/http` carries a ~6-line case-insensitive reader rather than widening core's public surface for one constant.

## Risks / Trade-offs

- *Risk:* a second framework-neutral surface (`@postel/http`) alongside core's `jwksHandler` could blur "where do HTTP things live?" → *Mitigation:* ADR 0014 states the rule — verify/sign/dedup live in core; HTTP gating/outcome lives in `@postel/http`; per-framework idioms live in adapter packages.
- *Risk:* the gate exposes the verified result on the framework request context (`c.set("postel", …)`), a typed contract per framework. → *Mitigation:* that typing is each adapter's concern (PORT-SPECIFIC); the core only deals in the normalized outcome.

## Open Questions

None blocking. The per-framework binding ergonomics (standalone `verifyWebhook`/`withWebhook` vs the `xAdapter(postel)` object) are settled at the plan level and realized in the adapter PRs.
