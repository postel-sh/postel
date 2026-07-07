# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | `@postel/admin`'s `GET /messages/:id/attempts` gains a `?status=` query filter, applied in the router over the public `outbound.messages.attempts(id)` read. No dispatch/signing/storage change. |
| typescript-receiver | unchanged | Inbound verify/dedup untouched. |
| go-sender (planned) | unchanged | A future port's admin surface MUST let a caller narrow a message's attempt history by delivery status — that OUTCOME is CONTRACT (part of the admin route set's request/response shapes). Filtering in the HTTP layer vs the storage read is a mechanism the port MAY vary. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Same as go-sender. |
| python-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | Same as go-sender. |
| rust-receiver (planned) | unchanged | |
| wire-format | unchanged | A query parameter on an existing admin read route. |
| db-schema | unchanged | No new columns; the read is unchanged. |

## Lockstep / lag

The CONTRACT addition is small: the admin attempts read accepts a status filter and returns only matching attempts. Ports adopt it whenever they implement the admin read plane; where the filtering happens (HTTP projection vs storage query) is a reference-implementation mechanism.
