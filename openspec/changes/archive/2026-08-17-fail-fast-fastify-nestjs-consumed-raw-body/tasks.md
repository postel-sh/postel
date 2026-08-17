## 1. Spec

- [x] 1.1 `receiver/spec.md`: add Fastify and NestJS scenarios to "Consumed raw body surfaces a descriptive configuration error".

## 2. Implementation

- [x] 2.1 `typescript/packages/frameworks/fastify/src/index.ts`: `rawBuffer()` throws `ConfigurationError` for a non-`Uint8Array`, non-nullish body.
- [x] 2.2 `typescript/packages/frameworks/nestjs/src/index.ts`: `toBytes()` throws `ConfigurationError` for a non-`Uint8Array`, non-`string`, non-nullish body.

## 3. Tests

- [x] 3.1 `fastify-adapter.test.ts`: scenario-named test for the manual `verifyWebhook` path without the raw-body plugin.
- [x] 3.2 `nestjs-adapter.test.ts`: scenario-named test for `WebhookGuard` without `rawBody: true`.

## 4. Verification

- [x] 4.1 `mise run check:all` at the repo root.
- [x] 4.2 `@postel/fastify` and `@postel/nestjs` test/lint/typecheck/build chains.
