# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | `toPublicEndpoint` normalizes the read shape: a `custom` retryPolicy reads back as `null`, and the returned `http` drops the function-typed `fetch` key — so memory and DB adapters return identical shapes. `Endpoint.retryPolicy` is typed to the data-only strategy variants; `Endpoint.http` omits `fetch`. |
| typescript-receiver | unchanged | |
| go-sender (planned) | unchanged | The OUTCOME is CONTRACT: an endpoint read exposes only serializable data, identically across storage adapters — function-carrying values never round-trip. Which option shapes are function-carrying is a per-port question (a port without code-side retry callbacks has nothing to carve out). |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Same as go-sender. |
| python-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | Same as go-sender. |
| rust-receiver (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | Normalization happens in the public read projection, above storage. |

## Lockstep / lag

No new cross-port obligation beyond the existing read-fidelity CONTRACT; this change closes two TypeScript-port leaks in it.
