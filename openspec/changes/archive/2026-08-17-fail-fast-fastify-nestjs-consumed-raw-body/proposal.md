## Why

The receiver spec's *Consumed raw body surfaces a descriptive configuration error* requirement says a gate MUST NOT feed an empty or re-serialized body into verification when an upstream parser already consumed the raw bytes — that degrades into a misleading `SIGNATURE_INVALID`. Express complies: its `rawBuffer()` throws a descriptive `ConfigurationError` for any non-`Uint8Array`, non-nullish body. Fastify's `rawBuffer()` and NestJS's `toBytes()` instead silently fall back to `new Uint8Array(0)` whenever the body isn't already raw bytes — on Fastify's manual `verifyWebhook` preHandler path (the `fastifyPostel` raw-body plugin not registered) and on NestJS's `WebhookGuard` (the Nest app booted without `rawBody: true`). Both then verify an empty body and fail with exactly the misleading `SIGNATURE_INVALID` the spec forbids, instead of a `ConfigurationError`.

The requirement's only scenario is Express-only, so this gap was never caught by spec-drift.

## What Changes

- `receiver`: *Consumed raw body surfaces a descriptive configuration error* gains a Fastify scenario (manual `verifyWebhook` preHandler without the raw-body plugin) and a NestJS scenario (`WebhookGuard` without `rawBody: true`), alongside the existing Express scenario.
- Fastify's `rawBuffer()` (`typescript/packages/frameworks/fastify/src/index.ts`) throws the same descriptive `ConfigurationError` as Express for any body that isn't `Uint8Array`/nullish.
- NestJS's `toBytes()` (`typescript/packages/frameworks/nestjs/src/index.ts`) throws the same descriptive `ConfigurationError` for any body that isn't `Uint8Array`/`string`/nullish.
- The `FastifyWebAdapter` facade path (which installs the raw-body content-type parser automatically) is unaffected — it never reaches the new throw.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `receiver`: MODIFIED "Consumed raw body surfaces a descriptive configuration error" — adds Fastify and NestJS scenarios.

## Wire-format / DB-schema impact

None.

## Impact

- `typescript/packages/frameworks/fastify/src/index.ts` — `rawBuffer()` throws `ConfigurationError` instead of returning an empty buffer.
- `typescript/packages/frameworks/nestjs/src/index.ts` — `toBytes()` throws `ConfigurationError` instead of returning an empty buffer.
- `typescript/packages/frameworks/fastify/test/fastify-adapter.test.ts` — new scenario-named test.
- `typescript/packages/frameworks/nestjs/test/nestjs-adapter.test.ts` — new scenario-named test.
