# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | `endpoints.get` / `update` throw the new typed `EndpointNotFound` instead of a plain `Error`. |
| typescript-receiver | modified | `@postel/http`'s exhaustive error→status policy maps `ENDPOINT_NOT_FOUND` → 404. |
| go-sender (planned) | unchanged | A future Go sender adds the same typed not-found error with the same `ENDPOINT_NOT_FOUND` code. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Same. |
| python-receiver (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

Adding a `PostelError` subclass extends the cross-port error vocabulary. Other ports MAY lag, but when a port's sender exposes endpoint reads it MUST use the same `ENDPOINT_NOT_FOUND` code so JSON consumers match across languages.
