# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | `@postel/admin` becomes a real Fetch router over `OutboundApi`; `@postel/express`/`@postel/fastify` gain a `fetchTo*` bridge to mount it. |
| typescript-receiver | unchanged | |
| go-sender (planned) | unchanged | A future Go sender ships its own admin handler reproducing the route set + JSON + error→status + default-deny posture (CONTRACT); the mount mechanism is its own. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Same control-plane contract. |
| python-receiver (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

The admin control-plane route set, JSON shapes, error→status mapping, and default-deny authorization are CONTRACT; ports MAY lag, but a port exposing an admin HTTP surface MUST reproduce them. The framework mount mechanism (Fetch handler vs framework bridge) is PORT-SPECIFIC.
