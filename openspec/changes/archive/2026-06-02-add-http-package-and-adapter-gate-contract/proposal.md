## Why

The only real framework adapter today (`@postel/hono`) is low-level: it takes a raw secret and calls `verify()` directly, ignoring the configured `Postel` instance, and forces every adopter to hand-roll the same loop in each route — read raw bytes, verify, map each `PostelError` to an HTTP status, dedup, ack. The other adapters are one-line stubs. There is no shared home for the verification-to-HTTP policy, so each future adapter (Express, Fastify, NestJS, …) would re-derive the error→status table and the raw-bytes plumbing — guaranteeing drift across adapters and risking the api-surface rule that implementation-state errors (`NotImplementedError`) must surface as 5xx, not 4xx.

This change introduces the framework-agnostic core every adapter binds to (`@postel/http`) and pins the verification **gate** contract + the error→status mapping in the `receiver` capability, so the policy is defined and tested exactly once.

## What Changes

- **NEW package `@postel/http`** — the framework-neutral webhook HTTP layer:
  - `handleInbound(source, { rawBody, headers, method }, opts) → WebhookOutcome` — the single verify → map-errors → optional dedup-ack pipeline, expressed as a normalized outcome.
  - `fetchWebhook(source, opts): (req: Request) => Promise<Response>` — a Web Fetch handler built on `handleInbound`, for Fetch-native runtimes (Hono, Bun, Deno, Next.js).
  - `@postel/http/node` entry — `writeOutcomeToNodeRes(res, outcome)` + `headersFromNode(req.headers)` for Node `req`/`res` frameworks (Express, Fastify) that call `handleInbound` directly.
  - `statusForError(err) / errorBody(err)` — the canonical `PostelError` → HTTP-status policy, in ONE place.
- **`receiver`** — ADD *Framework adapters gate verification and map protocol errors to HTTP status* (the status table; non-`PostelError` bubbles as 5xx) and *Framework adapters offer optional dedup-acknowledgement* (verify-then-dedup; `2xx` + `X-Postel-Dedup-Result: duplicate`; handler skipped on duplicate).
- **`distribution-packaging-typescript`** — MODIFIED *Package map* (add `@postel/http`); ADD *Framework adapters share a framework-agnostic HTTP core* (every adapter depends on `@postel/http` for the one error→status policy); MODIFIED *Tree-shakeability* (the core is importable with no framework pulled in).
- **ADR 0014** records the pattern: framework-agnostic Fetch/outcome core + thin per-framework gate bindings.

## Capabilities

### New Capabilities

None. `@postel/http` is a new *package*, but its behavior is receiver-side and specified under the existing `receiver` capability — no new capability-spec folder.

### Modified Capabilities

- **`receiver`** — ADD two requirements (the verification gate + error→status contract, and optional dedup-acknowledgement).
- **`distribution-packaging-typescript`** — MODIFIED *Package map* and *Tree-shakeability*; ADD *Framework adapters share a framework-agnostic HTTP core*.

## Wire-format / DB-schema impact

Wire-format: unchanged.
DB-schema: unchanged.

## Impact

- New `typescript/packages/http/` package (src + tests); depends only on `@postel/core`.
- `openspec/specs/receiver/spec.md` — two requirements added.
- `openspec/specs/distribution-packaging-typescript/spec.md` — Package map + Tree-shakeability modified, one requirement added.
- `decisions/0014-framework-adapter-pattern.md` — new ADR.
- `scripts/spec-drift-deferred.txt` — add the new packaging-policy requirement, consistent with the other `distribution-packaging-typescript` entries already deferred there.
