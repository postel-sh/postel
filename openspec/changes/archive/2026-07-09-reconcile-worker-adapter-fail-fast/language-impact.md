# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | unchanged | spec-text-only reconciliation; runtime behavior (fail fast) was already correct |
| typescript-receiver | unchanged | |
| go-sender (planned) | unaffected | the fail-fast OUTCOME is the CONTRACT obligation once a port ships a typed-but-unrun worker slot; mechanism and schedule are PORT-SPECIFIC |
| go-receiver (planned) | unaffected | |
| python-sender (planned) | unaffected | same CONTRACT obligation as go-sender |
| python-receiver (planned) | unaffected | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

No port is required to ship BullMQ/pg-boss/external-queue runtimes on any particular schedule. Once a port exposes a typed worker-strategy slot for a queue it hasn't wired a runtime for, it MUST fail fast at construction rather than silently no-op or fall back — that outcome is CONTRACT; the exact mechanism and slot set are PORT-SPECIFIC, per *Unimplemented config slots fail fast at construction*.
