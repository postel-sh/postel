| Port | Status | Notes |
|---|---|---|
| typescript-sender | unchanged | Sender produces wire-format; the dedup verdict is a receiver-side concern. |
| typescript-receiver | modified | `@postel/edge` (Track B) must emit `X-Postel-Dedup-Result: duplicate` when the configured dedup helper reports a duplicate. Lockstep with the suite at `0.1.x`. |
| go-sender (planned) | unchanged | n/a |
| go-receiver (planned) | modified (future) | Same convention; lands when the Go receiver is implemented. |
| python-sender (planned) | unchanged | n/a |
| python-receiver (planned) | modified (future) | Same convention; lands when the Python receiver is implemented. |
| wire-format | unchanged | The `X-Postel-Dedup-Result` header is a runner ↔ receiver test convention, not part of the public Standard Webhooks delivery contract. |
| db-schema | unchanged | n/a |

The compliance **runner** itself (Go module at `compliance/cli/`) MUST update its `ClassifyResponse` to recognise the header. There is currently one runner implementation; any future re-implementation in another language must match this behaviour.
