# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-receiver | modified | Hono/Express/Fastify gain the `XxxWebAdapter(postel, app)` routing facade (`inbound.<source>.post`, `outbound.bindJwks`, `admin.bindAdminRoutes`); the old `xAdapter` objects + `honoVerify`/`postelHono` are removed; low-level `verifyWebhook`/`withWebhook` primitives stay. NestJS renames `createPostelDecorators` → `NestjsWebAdapter`. |
| typescript-sender | unchanged | The JWKS key source (`publicJwks`) and admin router are reused as-is; only the HTTP binding ergonomics change. |
| go-receiver (planned) | unchanged | A future port binds the gate + JWKS + admin in its own framework idioms; the wire outcome, JWKS document, and well-known path are CONTRACT. The adapter object ergonomics are PORT-SPECIFIC. |
| go-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | |
| rust-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

TypeScript-port-only ergonomics + naming change over unchanged `@postel/http` wire behavior, permitted by ADR 0014 (adapter ergonomics + JWKS binding shape are PORT-SPECIFIC). The served JWKS document and well-known path remain CONTRACT, so the compliance suite and any future port are unaffected.
