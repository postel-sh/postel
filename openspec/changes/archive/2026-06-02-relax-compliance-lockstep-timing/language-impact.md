# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | unchanged | Versioning-policy change only; no sender-runtime behavior change. |
| typescript-receiver | unchanged | |
| go-sender (planned) | unchanged | Net relief — a port may adopt a new suite MINOR on its own schedule rather than releasing in lockstep with the suite. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | |
| rust-receiver (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

This change *defines* the lag model. The shared `MAJOR.MINOR` version line and the version-match rule (a port at `X.Y.Z` passes `compliance@X.Y.*`) stay CONTRACT, but during `0.x` the suite leads and each port converges to its version numbers on its own schedule — the suite's latest released version MAY be ahead of any port's. MAJOR boundaries remain a coordinated cut across the suite and all ports. No port is forced to release in lockstep with the suite pre-1.0.
