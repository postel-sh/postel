## Why

The framework-adapter rework (ADR 0014) now covers Hono, Express, and Fastify on the shared `@postel/http` gate. NestJS — a DI-first framework with a large adopter base — has no Postel adapter, and it is the one mainstream framework whose idiom (guards + decorators) differs enough that the raw middleware/preHandler patterns don't apply. NestJS is also absent from the `receiver` adapter list entirely.

## What Changes

- **NEW package `@postel/nestjs`**: a `PostelModule.forRoot(postel)` (provides the configured instance), a `WebhookGuard(key)` `CanActivate` gate built on `@postel/http` (verifies the raw body, maps `PostelError` to an `HttpException` status, sets the verified result on the request, bubbles non-`PostelError` as 5xx), `@Event()` / `@WebhookResult()` param decorators, and `createPostelDecorators(postel)` for compile-time-checked source keys.
- **`receiver`** — MODIFIED *Framework adapters preserve raw bytes*: add NestJS to the adapter list and a NestJS scenario.
- **`distribution-packaging-typescript`** — MODIFIED *Package map*: add `@postel/nestjs` to the Framework adapters group.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`receiver`** — MODIFIED *Framework adapters preserve raw bytes* (add NestJS + scenario).
- **`distribution-packaging-typescript`** — MODIFIED *Package map* (add `@postel/nestjs`).

## Wire-format / DB-schema impact

Wire-format: unchanged.
DB-schema: unchanged.

## Impact

- New `typescript/packages/frameworks/nestjs/` package (depends on `@postel/core` + `@postel/http`; peers `@nestjs/common`, `reflect-metadata`, `rxjs`).
- Docs: [frameworks](../../../docs/content/docs/inbound/frameworks.mdx) status table + a NestJS note; [packages](../../../docs/content/docs/reference/packages.mdx).
- Decorators are applied programmatically (not as `@`-syntax) in the package source so it parses under the repo's TC39-decorator tooling; runtime metadata is identical. Adopters use the decorators with normal `@` syntax in their own NestJS apps.
