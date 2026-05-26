# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | new | `@postel/memory` adapter ships in PR-T1; `@postel/compliance-driver` ships in PR-T5. |
| typescript-receiver | unchanged | Receiver surface unaffected. |
| go-sender (planned) | unchanged | A future Go port lands its own `compliance-driver-go` (or equivalent) via its own `distribution-packaging-go` capability spec; the TS additions here don't dictate Go's package map. |
| go-receiver (planned) | unchanged | Same. |
| python-sender (planned) | unchanged | Same. |
| python-receiver (planned) | unchanged | Same. |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

Only the TypeScript port is affected. The change is a package-map addition: two new TS-only npm packages. Other ports MAY introduce their own equivalents on their own cadence; nothing in this change forces a lockstep update.
