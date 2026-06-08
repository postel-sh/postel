# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-receiver | modified | Inbound sources gain an optional `schema` (Standard Schema v1, inlined — no runtime dep); `verify()` validates `event.data` after the signature check and throws `EventValidation` (`EVENT_VALIDATION`). The verified `TData` is inferred from the schema output; framework gates map `EVENT_VALIDATION → 422`. |
| typescript-sender | unchanged | Outbound signing/dispatch untouched. |
| go-receiver (planned) | unchanged | A future port MAY offer per-source payload validation through its own idioms; the CONTRACT is the wire outcome (`EVENT_VALIDATION → 422`) + that validation runs only after a successful signature check. Standard Schema / type inference is a TypeScript-port mechanism. |
| go-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | |
| rust-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

The CONTRACT additions — `EVENT_VALIDATION` in the verify error set and `EVENT_VALIDATION → 422` in the gate status table — are wire-observable and apply to any port that chooses to validate payloads. Schema declaration + end-to-end typing via Standard Schema is a TypeScript-port mechanism (`@postel/core` inlines the interface, zero runtime dependency); other ports are free to expose payload validation differently.
