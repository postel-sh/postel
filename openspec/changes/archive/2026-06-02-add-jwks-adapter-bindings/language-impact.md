# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-receiver | modified | `@postel/http` gains `jwksFetchHandler`; the Hono/Express/Fastify adapters gain `.jwks(provider)`. |
| typescript-sender | unchanged | The key source (`publicJwks`) landed separately; this only adds the HTTP mount. |
| go-receiver (planned) | unchanged | A future port mounts its current public keys via its own framework idioms; the JWKS document + path are CONTRACT. |
| go-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

Additive TypeScript-port HTTP binding over the existing `publicJwks` source. The served JWKS document and well-known path are CONTRACT; the `.jwks()` binding shape is PORT-SPECIFIC.
