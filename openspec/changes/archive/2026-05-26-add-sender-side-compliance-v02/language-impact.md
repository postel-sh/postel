# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | new | First conformant driver is `@postel/compliance-driver` (added by `add-postel-memory-and-compliance-driver-packages`). |
| typescript-receiver | unchanged | Receiver-mode vectors and behavior unchanged; v0.1.0 vectors continue to validate. |
| go-sender (planned) | unchanged | Future Go sender ships its own conformant driver implementing the same control-plane route set. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Same. |
| python-receiver (planned) | unchanged | Same. |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

The TypeScript sender + driver land together at v0.2.0. Other ports may lag — their senders are deferred per [ADR 0005](../../../decisions/0005-polyglot-staged-rollout.md). When a non-TS port ships a sender, it ships a conformant driver in lockstep and the suite-version-pass requirement applies from that release.
