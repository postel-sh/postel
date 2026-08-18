## 1. Spec

- [x] 1.1 `sender/spec.md`: add "Bounded single-pass drain for serverless invocation" (ADDED, CONTRACT) with three scenarios (maxMessages, deadline, concurrent-with-pool).
- [x] 1.2 `api-surface-typescript/spec.md`: add `drain` to the outbound surface list in "Postel factory returns the library instance" (MODIFIED) and add the "Outbound drain surface is present" scenario.

## 2. Implementation

- [ ] 2.1 Extract `Worker.processOne`'s reserve-renew-dispatch-release logic into a shared `sender/worker/process-one.ts` helper; update `Worker` to call it.
- [ ] 2.2 Add `sender/worker/drain.ts` exporting `drainOnce(ctx, opts)`: loops `reserveBatch` (capped by remaining `maxMessages`) + the shared per-message helper until `maxMessages` is reached, the deadline elapses, or the outbox has nothing left to reserve.
- [ ] 2.3 Wire `OutboundApi.drain` in `outbound.ts`'s `buildOutboundRuntime`, reusing the same `storage`/`clock`/rate-limited `dispatchOne` the worker pool uses.
- [ ] 2.4 Export `DrainOptions`/`DrainResult` from `src/index.ts`.

## 3. Tests

- [ ] 3.1 `typescript/packages/core/test/drain.test.ts`: one test per new `sender` scenario (test description includes the scenario title verbatim).

## 4. Docs

- [ ] 4.1 New `docs/content/docs/outbound/serverless.mdx`: cron-triggered `drain()` patterns for Vercel Cron, AWS Lambda + EventBridge, Cloudflare Cron Triggers; explicit latency trade-offs.
- [ ] 4.2 `docs/content/docs/outbound/meta.json`: add `serverless` to `pages`.
- [ ] 4.3 `docs/content/docs/outbound/index.mdx`: add a `drain()` / serverless row to the feature table and a link to the new page.

## 5. Verification

- [ ] 5.1 `openspec validate add-serverless-bounded-drain` then `openspec archive add-serverless-bounded-drain -y`.
- [ ] 5.2 `mise run check:all` at the repo root.
- [ ] 5.3 `@postel/core` test/lint/typecheck/build chain inside `typescript/`.
