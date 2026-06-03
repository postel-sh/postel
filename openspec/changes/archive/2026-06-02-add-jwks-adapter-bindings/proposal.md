## Why

With the JWKS key-source landed (`outbound.keys.publicJwks()`), the framework adapters can finally mount a JWKS endpoint that serves the sender's *current* public keys. Until now the only mount helper was `jwksHandler({ keys })`, which bakes a static key set at construction — so rotated/ephemeral keys would not appear without redeploying. Adapters need a per-request binding fed by `publicJwks`.

## What Changes

- **NEW `jwksFetchHandler(provider)` in `@postel/http`**: a Web-Fetch handler that calls the provider per request and serves the result via core `jwksHandler` — so a `() => outbound.keys.publicJwks()` provider reflects rotations without reconstructing the handler.
- **`.jwks(provider)` on each adapter object**: `honoAdapter`, `expressAdapter`, `fastifyAdapter` gain `.jwks(provider)` returning that framework's GET handler (Express/Fastify bridge a Web `Response` to `res`/`reply` via `@postel/http/node`'s `writeResponseToNodeRes`). Fetch-native runtimes may use `jwksFetchHandler` directly; NestJS mounts it in a controller with `@Res()`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`key-management`** — MODIFIED *JWKS endpoint mounter*: the mount helper is `jwksHandler({ keys })` (static) plus `jwksFetchHandler(provider)` (per-request), surfaced as each adapter's `.jwks(provider)`; add Fastify + per-request-refresh scenarios.

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: unchanged.

## Impact

- `typescript/packages/http/src/jwks.ts` (`jwksFetchHandler`) + `src/node.ts` (`writeResponseToNodeRes`).
- `.jwks(provider)` in `@postel/hono`, `@postel/express`, `@postel/fastify` adapter objects.
- Docs: [key-rotation](../../../docs/content/docs/inbound/key-rotation.mdx) — `.jwks()` now ships.
