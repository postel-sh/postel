# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | `rotateSecret` stores the v1a public key; the dispatcher stamps `webhook-key-id`; `outbound.keys.publicJwks` added. |
| typescript-receiver | unchanged | Already reads `webhook-key-id` and matches JWK `kid` for `Keyset` verification. |
| go-sender (planned) | unchanged | When a Go sender ships, it MUST reproduce the RFC 7638 kid + `webhook-key-id` contract so receivers `kid`-lookup across ports. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Same kid/key-id contract. |
| python-receiver (planned) | unchanged | |
| wire-format | unchanged | `webhook-key-id` is the existing receiver-side key-id header; the sender now populates it. No new AsyncAPI field. |
| db-schema | modified | `endpoint_secrets.public_key` (nullable, forward-only) — see `db-schema-delta.sql`. |

## Lockstep / lag

The kid scheme (RFC 7638 JWK thumbprint) is a cross-port CONTRACT: every port's signer and JWKS publisher MUST derive the same `kid` from the same public key. Other ports MAY lag, but a port shipping an asymmetric sender MUST adopt this kid derivation and the `endpoint_secrets.public_key` column.
