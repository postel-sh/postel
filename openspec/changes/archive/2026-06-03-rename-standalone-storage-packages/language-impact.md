# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | Package rename only: `@postel/standalone-pg` → `@postel/pg`, `@postel/standalone-sqlite` → `@postel/sqlite`. No runtime/behavior change; the dedup adapter exports keep their names. |
| typescript-receiver | unchanged | |
| go-sender (planned) | unchanged | Each port chooses its own package/module names; the three-category model (standalone / client / ORM) is the shared concept, not the npm names. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | |
| rust-receiver (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

Naming-only change in the TypeScript port's package map. The cross-port CONTRACT (the operation-shaped `Storage` interface and the three adapter categories) is unaffected — npm package names are TypeScript-port-specific, so no other port lags or leads on this.
