## MODIFIED Requirements

### Requirement: Framework adapters preserve raw bytes

The library SHALL provide middleware adapters for Express, Fastify, Koa, Hono, Elysia, NestJS, `Bun.serve`, `Deno.serve`, Next.js Route Handlers, SvelteKit, Astro, and Nitro that preserve the raw request bytes passed to `verify`. JSON re-serialization MUST NOT happen between receipt and verification.

#### Scenario: Express adapter preserves bytes

- **WHEN** an Express route uses the Postel middleware
- **THEN** `verify` receives the exact bytes the receiver received, not a re-serialized JSON

#### Scenario: NestJS adapter preserves bytes

- **WHEN** a NestJS route is protected by the Postel `WebhookGuard` with raw-body buffering enabled (`rawBody: true`)
- **THEN** `verify` receives the exact bytes the receiver received, not a re-serialized JSON
- **AND** a re-serialized body is rejected as a verification failure rather than silently accepted
