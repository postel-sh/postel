## Why

The per-framework adapter surface is awkward. Each framework exposes a lowercase `xAdapter(postel)` factory returning a `{ verify, guard, jwks }` object, alongside loose `verifyWebhook`/`withWebhook` helpers, deprecated secret-based shims (`honoVerify`/`postelHono`), and a `.jwks(provider)` binding that forces the adopter to hand-thread a provider. Wiring a single webhook means juggling several names and remembering to mount the gate, JWKS, and admin router separately. The `.jwks(provider)` binding also misplaces a sender concern: it publishes *your own* public keys at a fixed well-known path, yet was surfaced as a free-floating method rather than grouped with the outbound surface.

## What Changes

- **NEW routing-facade `XxxWebAdapter(postel, app)`** per route-registration framework (Hono, Express, Fastify): registers gated routes directly onto the host's app, grouped by intent —
  - `hwa.inbound.<source>.post(route, handler, opts?)` — raw bytes verified before the handler runs; protocol errors mapped to status; optional dedup-ack. Thin sugar over the existing `withWebhook` primitive.
  - `hwa.outbound.bindJwks(route?, provider?)` — publishes the sender's public keys; defaults to `/.well-known/webhooks-keys` and `() => outbound.keys.publicJwks()`.
  - `hwa.admin.bindAdminRoutes(prefix, opts)` — mounts the `@postel/admin` router at a prefix.
  - The `inbound` / `outbound` / `admin` groups appear conditionally on which config slots exist, mirroring the conditional shape of the `Postel` instance itself.
- **JWKS moves from `.jwks(provider)` to `outbound.bindJwks(route?, provider?)`** — it is a sender concern (you publish your own keys), not per-inbound-source. The CONTRACT (served document, `application/jwk-set+json`, well-known path, GET/HEAD handling) is unchanged.
- **Hard replace, no deprecation shims**: the `honoAdapter` / `expressAdapter` / `fastifyAdapter` objects and the deprecated `honoVerify` / `postelHono` helpers are removed. The low-level primitives (`verifyWebhook`, `withWebhook`, `fetchToExpress`, `fetchToFastify`, `fastifyPostel`, and `@postel/http`'s `jwksFetchHandler`) remain as documented building blocks — the facade is sugar over them.
- **NestJS keeps its decorator/guard model** (imperative route registration does not fit DI). `createPostelDecorators` is renamed `NestjsWebAdapter`; `PostelModule` / `WebhookGuard` / `Event` / `WebhookResult` are unchanged. JWKS and admin stay controller-mounted.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`key-management`** — MODIFIED *JWKS endpoint mounter*: the per-framework binding is now `outbound.bindJwks(route?, provider?)` (was `.jwks(provider)`), with defaulted route and provider. The CONTRACT (document shape, content type, well-known path, GET/HEAD handling) is unchanged; only the PORT-SPECIFIC binding shape and the scenario examples change.

No change to `receiver` (its gate/raw-bytes scenarios describe behavior, not factory names) or `api-surface-typescript` (it does not name the adapter factories).

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: unchanged. This is a PORT-SPECIFIC TypeScript ergonomics + naming change permitted by [ADR 0014](../../../decisions/0014-framework-adapter-pattern.md); the verify-to-HTTP wire behavior stays in `@postel/http`.

## Impact

- `@postel/hono`, `@postel/express`, `@postel/fastify` — new `XxxWebAdapter(postel, app)` facade; remove the old `xAdapter` objects + `honoVerify`/`postelHono`; add a `@postel/admin` dependency for `bindAdminRoutes`.
- `@postel/nestjs` — rename `createPostelDecorators` → `NestjsWebAdapter`.
- Adapter test suites (hono/express/fastify/nestjs), preserving requirement titles for spec-drift.
- Docs: `docs/content/docs/web-adapters/*`, `inbound/key-rotation.mdx`, `outbound/{index,admin}.mdx`, `reference/packages.mdx`, and the homepage hero snippet in `docs/app/(home)/page.tsx`.
- No change to `@postel/http` pipeline behavior, the `PostelError`→status table, or the JWKS document — the compliance suite is unaffected.
