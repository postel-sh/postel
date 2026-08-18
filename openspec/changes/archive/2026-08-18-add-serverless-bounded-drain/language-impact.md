# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | `postel.outbound.drain({ maxMessages, deadline })` added; reuses the existing `reserveBatch`/lease reservation path, no new persistent loop |
| typescript-receiver | unchanged | |
| go-sender (planned) | unaffected | the bounded-single-pass-drain OUTCOME is CONTRACT once a port ships this primitive; the method name/shape and the reservation mechanism are PORT-SPECIFIC |
| go-receiver (planned) | unaffected | |
| python-sender (planned) | unaffected | same CONTRACT obligation as go-sender |
| python-receiver (planned) | unaffected | |
| wire-format | unchanged | |
| db-schema | unchanged | `drain()` reads/writes the existing outbox and lease columns through the existing `Storage` interface — no new tables or columns |

## Lockstep / lag

No port is required to ship a `drain()` equivalent on any particular schedule. Once a port exposes a bounded single-pass drain primitive, it MUST satisfy the CONTRACT outcome (processes at most N messages or runs until a deadline, then returns without spawning a persistent loop; safe alongside a running long-lived worker pool) — the method name, options shape, and internal reservation bookkeeping are PORT-SPECIFIC. How a host schedules recurring `drain()` invocations (cron, HTTP handler, queue trigger, …) is host-determined in every port and is not part of any port's contract.
