# Tasks

## 1. Spec

- [ ] 1.1 MODIFY `key-management` *JWKS endpoint mounter*: binding becomes `outbound.bindJwks(route?, provider?)`; update Hono + Fastify scenario examples. CONTRACT unchanged.

## 2. Implementation

- [ ] 2.1 `@postel/hono` — `HonoWebAdapter(postel, app)` with `inbound.<source>.post`, `outbound.bindJwks`, `admin.bindAdminRoutes`. Remove `honoAdapter`, `honoVerify`, `postelHono`. Keep `verifyWebhook`, `withWebhook`, `POSTEL_CONTEXT_KEY`. Add `@postel/admin` dep.
- [ ] 2.2 `@postel/express` — `ExpressWebAdapter(postel, app)`; remove `expressAdapter`; keep `verifyWebhook`/`withWebhook`/`fetchToExpress`. Add `@postel/admin` dep.
- [ ] 2.3 `@postel/fastify` — `FastifyWebAdapter(postel, app)`; remove `fastifyAdapter`; keep `verifyWebhook`/`withWebhook`/`fetchToFastify`/`fastifyPostel`. Add `@postel/admin` dep.
- [ ] 2.4 `@postel/nestjs` — rename `createPostelDecorators` → `NestjsWebAdapter`; keep `PostelModule`/`WebhookGuard`/`Event`/`WebhookResult`.

## 3. Tests

- [ ] 3.1 Rewrite hono/express/fastify/nestjs adapter tests to the new surface; keep requirement titles (`JWKS endpoint mounter`, `Framework adapters preserve raw bytes`, `Framework adapters gate verification and map protocol errors to HTTP status`) verbatim for spec-drift.
- [ ] 3.2 Drop `honoVerify`/`postelHono` tests; add facade tests (`inbound.<source>.post`, `outbound.bindJwks()` defaults, `admin.bindAdminRoutes` authorized + denied).

## 4. Docs

- [ ] 4.1 Update `docs/content/docs/web-adapters/{index,hono,express,fastify,nestjs}.mdx`, `inbound/key-rotation.mdx`, `outbound/{index,admin}.mdx`, `reference/packages.mdx`, and the homepage hero snippet in `docs/app/(home)/page.tsx`.

## 5. Verify

- [ ] 5.1 `mise run test`, `mise run typecheck`, `mise run lint`, `mise run check:all`, `mise run docs:typecheck`.
- [ ] 5.2 Archive the change (`openspec archive rework-web-adapter-ergonomics -y`) and open the PR.
