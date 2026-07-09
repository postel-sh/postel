# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | `send()` gains an optional `outbound.events` registry + validation; non-breaking when unset |
| typescript-receiver | unchanged | no receiver-side change; reuses the existing inbound schema mechanism as precedent |
| go-sender (planned) | unaffected | mechanism is TypeScript-port-specific; the OUTCOME (validate-before-persist, throw on mismatch) is CONTRACT and MUST be honored when the Go port lands |
| go-receiver (planned) | unaffected | |
| python-sender (planned) | unaffected | same CONTRACT obligation as go-sender |
| python-receiver (planned) | unaffected | |
| wire-format | unchanged | rejected sends never reach the wire; nothing serialized differently |
| db-schema | unchanged | validation happens before the outbox row is written; no new columns |

## Lockstep / lag

Only the TypeScript sender changes now. Other ports MAY lag — the registry's schema mechanism is PORT-SPECIFIC — but each port MUST honor the CONTRACT outcome (validate before persisting an outbox row; throw a structured validation error on mismatch; unregistered types stay fully permissive) once it implements outbound sending, per `sender`'s "Per-type event schema validation on send" requirement.
