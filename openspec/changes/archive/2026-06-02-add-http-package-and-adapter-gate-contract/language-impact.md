# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-receiver | modified | Adds the `@postel/http` core + the verification-gate / error→status contract that adapters bind to. The verify / dedup behavior inside `@postel/core` is unchanged; this layers the HTTP gate on top. |
| typescript-sender | unchanged | |
| go-receiver (planned) | unchanged | A future Go receiver reproduces the CONTRACT error→status outcome + dedup-ack signal via Go's `http.Handler`; the `@postel/http` package shape is TS-specific. |
| go-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | Same — the gate outcome is CONTRACT; the framework-neutral layer (ASGI/WSGI) is port-specific. |
| python-sender (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

The TypeScript port ships `@postel/http` + the gate contract now. Other ports MAY lag — their receiver framework adapters are deferred per [ADR 0005](../../../decisions/0005-polyglot-staged-rollout.md). When a port ships framework adapters it MUST reproduce the CONTRACT error→status mapping and the `X-Postel-Dedup-Result` dedup-ack signal, in its own framework-neutral layer.
