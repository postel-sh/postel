# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | Removes the `update_endpoint` control-plane route from `@postel/compliance-driver` and the two late-binding vectors. No sender-runtime behavior change. |
| typescript-receiver | unchanged | |
| go-sender (planned) | unchanged | Net simplification — future ports no longer need to implement an `update_endpoint` control-plane route to be v0.2-conformant. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

Shrinks the v0.2.0 sender corpus and the control-plane contract; no port is forced to change in lockstep. Late-binding-via-update lands in a later MINOR alongside the executing Go sender-mode runner.
