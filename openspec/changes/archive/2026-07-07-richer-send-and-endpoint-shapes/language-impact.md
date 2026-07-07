# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | **BREAKING** `outbound.send()` now resolves to `SendResult { id, reused }` instead of a bare `MessageId`, and the public `Endpoint` returned by `endpoints.create/get/list/update` carries every accepted serializable field (`types`, `channels`, `retryPolicy`, `allowHttp`, `maxInflight`, `http`, `circuitBreaker`, `autoDisable`, `createdAt`, `updatedAt`, plain-record `headers`). No dispatch, signing, or storage-schema change. |
| typescript-receiver | unchanged | Inbound verify/dedup untouched. |
| go-sender (planned) | unchanged | The OUTCOMES are CONTRACT: a send reports both the message identity and whether an idempotency key matched an existing row, and an endpoint read round-trips every accepted serializable field. The `SendResult` name, the `reused` field name, and the exact endpoint-struct shape are TypeScript-port mechanisms; ports MAY surface these through their own idioms. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Same as go-sender. |
| python-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | Same as go-sender. |
| rust-receiver (planned) | unchanged | |
| wire-format | unchanged | Delivery headers, signatures, and payload are untouched; this changes only the host-facing library API. The compliance control plane's `/control/send` response stays `{ messageId }`. |
| db-schema | unchanged | Both results project columns that already exist (`messages.idempotency_key` uniqueness; `endpoints.*`). |

## Lockstep / lag

The CONTRACT additions are the two return-fidelity OUTCOMES above. Any sender port SHALL provide them before claiming sender parity at the frozen contract, but MAY lag until it implements a sender. Function-shaped endpoint options (`filter`, `transform`, callable `headers`) staying off the read shape is CONTRACT — they are code-side values that cannot round-trip through serializable reads.
