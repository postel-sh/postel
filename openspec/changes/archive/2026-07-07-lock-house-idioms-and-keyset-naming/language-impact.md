# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | **BREAKING** `endpoints.create` / `endpoints.update` lose the trailing `runtime?: { tx }` argument; `tx` rides in the options bag. Outbound `MessageId` becomes the single shared alias. |
| typescript-receiver | modified | **BREAKING** `createKeyset` → `createJwksKeyset`, type `Keyset` → `JwksKeyset`, `SecretOrKeyset` → `SecretOrJwksKeyset`, type `Secret` → `SecretValue`; `InboundSource.now` / `VerifyOptions.now` → `clock?: Clock`. `tolerance` additionally accepts duration strings. Verification behavior, headers, and signatures are unchanged. |
| go-sender (planned) | unchanged | MUST mirror the locked idioms from ADR 0016 when implemented: tx in the options bag, durations accept integer seconds and the shared duration-string grammar, one clock abstraction, no colliding public names. |
| go-receiver (planned) | unchanged | Same as go-sender; keyset constructor / keyset type / verifier factory MUST be distinguishable by name. |
| python-sender (planned) | unchanged | Same as go-sender. |
| python-receiver (planned) | unchanged | Same as go-receiver. |
| rust-sender (planned) | unchanged | Same as go-sender. |
| rust-receiver (planned) | unchanged | Same as go-receiver. |
| wire-format | unchanged | Naming and config-shape only; no header, envelope, or signature change. |
| db-schema | unchanged | No schema change. |

## Lockstep / lag

No port exists beyond TypeScript yet, so nothing must move in lockstep. The point of landing this inside the M3 freeze is that future ports start from the locked idioms (ADR 0016) instead of inheriting the drift; they adopt the idioms at birth rather than migrating later.
