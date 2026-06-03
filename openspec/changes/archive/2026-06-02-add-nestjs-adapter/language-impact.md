# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-receiver | new | Adds the `@postel/nestjs` adapter (`PostelModule`, `WebhookGuard`, `@Event`/`@WebhookResult`) on the shared `@postel/http` gate. |
| typescript-sender | unchanged | |
| go-receiver (planned) | unchanged | A future Go receiver reproduces the gate outcome via its own idioms; NestJS is TS-specific. |
| go-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

Pure additive TypeScript-port package; other ports are unaffected. The CONTRACT outcome (gate before handler, error→status mapping, byte preservation) is inherited from `@postel/http`; only the NestJS binding (guard + decorators) is new and is PORT-SPECIFIC mechanism.
