# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | In-memory `Storage` adapter relocates from `@postel/memory` into `@postel/core`; sender-runtime tests move into `@postel/core/test`. No runtime-behavior change. |
| typescript-receiver | unchanged | |
| go-sender (planned) | unchanged | Each port decides where its own in-memory reference adapter lives; this is a TS-port packaging choice. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

TS-port-only packaging change. No other port is affected; nothing changes in lockstep.
