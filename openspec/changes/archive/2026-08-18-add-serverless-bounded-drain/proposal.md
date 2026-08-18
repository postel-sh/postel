## Why

Issue #146: the only way to run outbound delivery is `postel.start()`, which spawns a persistent in-process worker loop — unusable on Lambda, Vercel Functions, or Cloudflare Workers, all of which terminate the process once a request/invocation finishes. There is no bounded, single-pass drain primitive, and "serverless" appears nowhere in `docs/`, `openspec/specs/`, or `VISION.md` (`grep -rn 'serverless|Lambda|drainOnce' docs/content/docs openspec/specs VISION.md` is empty). TS-first positioning makes a serverless caller a real audience the library currently turns away.

## What Changes

- `sender`: add a CONTRACT requirement for a bounded single-pass drain — `postel.outbound.drain({ maxMessages, deadline })` reserves and dispatches at most `maxMessages` messages, or runs until `deadline` elapses (whichever comes first), then returns without starting a persistent loop. It reuses the same `reserveBatch`/lease reservation mechanism as the in-process worker pool, so a drain call is safe to run concurrently alongside a running `postel.start()` pool (no double-processing). The requirement's prose notes, without a separate formal requirement, that *how* a host triggers `drain()` on a recurring basis (cron, HTTP handler, queue consumer, …) is host-determined and outside the library's contract.
- `api-surface-typescript`: extend the *Postel factory returns the library instance* requirement's outbound method list with `drain`, and add a scenario confirming the surface is present and well-typed.
- Implementation: extract the worker's per-message dispatch-with-lease-renewal logic into a shared helper reused by both the long-lived `Worker` and the new bounded `drainOnce`, so the two entry points share reservation/lease/dispatch semantics instead of duplicating them.
- Docs: a new `docs/content/docs/outbound/serverless.mdx` page with concrete cron-triggered `drain()` patterns for Vercel Cron, AWS Lambda + EventBridge, and Cloudflare Cron Triggers, with honest latency trade-offs (delivery latency is bounded by the cron interval, not real-time). `docs/content/docs/outbound/index.mdx` gets a pointer to it and a `drain()` row in the feature table.

No wire-format or DB-schema changes — `drain()` is a new entry point over the existing outbox/lease schema.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sender`: ADDED requirement "Bounded single-pass drain for serverless invocation".
- `api-surface-typescript`: MODIFIED requirement "Postel factory returns the library instance" — adds `drain` to the enumerated outbound surface and a new scenario.

## Impact

- `@postel/core`: `src/outbound.ts` (`OutboundApi.drain`, wiring in `buildOutboundRuntime`), `src/sender/worker/pool.ts` (export shared lease defaults), `src/sender/worker/process-one.ts` (new, extracted from `worker.ts`), `src/sender/worker/worker.ts` (use the extracted helper), `src/sender/worker/drain.ts` (new, `drainOnce`), `src/index.ts` (export `DrainOptions`/`DrainResult`).
- `docs/`: new `outbound/serverless.mdx`, `outbound/index.mdx` and `outbound/meta.json` updated.
