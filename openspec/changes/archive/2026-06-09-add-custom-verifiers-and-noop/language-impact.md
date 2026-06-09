# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-receiver | modified | `Verifier` becomes an open `verify(...)` contract; `Secret`/`PublicKey`/`Keyset` delegate to the built-in `verify()` (no behaviour change); new `Noop()` verifier skips authentication but still parses the envelope. Custom verifiers compose with built-ins under the unchanged composition rules. |
| typescript-sender | unchanged | |
| go-receiver (planned) | unchanged | A future port MAY expose custom verification and a skip-verification escape hatch in its own idiom (trait/protocol), or omit the latter — both are PORT-SPECIFIC. The signing-scheme behaviour and verifier composition (`matchedVerifierIndex`) remain CONTRACT. |
| go-sender (planned) | unchanged | |
| python-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | |
| rust-receiver (planned) | unchanged | |
| rust-sender (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | |

## Lockstep / lag

TypeScript-port-only ergonomics + extensibility addition. No port must change in lockstep: the cross-port contract (signing schemes, verifier composition, `matchedVerifierIndex`) is unchanged, so the compliance suite and any future port are unaffected. The custom-verifier mechanism and `Noop()` are PORT-SPECIFIC per ADR 0008.
