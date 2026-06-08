## MODIFIED Requirements

### Requirement: JWKS endpoint mounter

The library SHALL provide a framework-agnostic JWKS handler the host mounts at `/.well-known/webhooks-keys` (or a per-tenant equivalent). `jwksHandler({ keys })` serves a static key set; `@postel/http`'s `jwksFetchHandler(provider)` serves a **per-request** key set, so a `() => outbound.keys.publicJwks()` provider reflects key rotation without reconstructing the handler or redeploying. Each framework web adapter SHALL expose an `outbound.bindJwks(route?, provider?)` binding that mounts the handler onto the host app (Express, Fastify, Hono); the route defaults to `/.well-known/webhooks-keys` and the provider defaults to `() => outbound.keys.publicJwks()`. Fetch-native runtimes MAY use `jwksFetchHandler` directly, and a NestJS app mounts it in a controller.

**Conformance**: the served JWKS document, its `application/jwk-set+json` content type, the well-known mount path, and the GET/HEAD-only method handling are CONTRACT. The `outbound.bindJwks(route?, provider?)` binding shape per framework is PORT-SPECIFIC.

#### Scenario: Hono JWKS handler

- **WHEN** the host calls `HonoWebAdapter(postel, app).outbound.bindJwks()` (defaulting the route to `/.well-known/webhooks-keys` and the provider to `() => postel.outbound.keys.publicJwks()`)
- **THEN** a GET request to that path returns a JWKS JSON document

#### Scenario: Fastify JWKS handler

- **WHEN** the host calls `FastifyWebAdapter(postel, app).outbound.bindJwks()` to mount the handler at the well-known path
- **THEN** a GET request returns a JWKS JSON document

#### Scenario: Per-request key refresh

- **WHEN** the provider returns an updated key set on a later request
- **THEN** the served JWKS reflects the new keys without the handler being reconstructed
