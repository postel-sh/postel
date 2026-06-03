# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | `endpoints.create` provisions the initial primary signing secret from the resolved signing strategy; `EndpointCreateOptions.provisionSecret?` opt-out; shared `mintSecretMaterial` helper. |
| typescript-receiver | unchanged | |
| go-sender (planned) | unchanged | A Go sender MUST offer some public path that makes a `v1a` endpoint's key publishable via `publicJwks` without a prior rotation; the API shape (auto-on-create vs explicit method) is PORT-SPECIFIC. |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Same outcome requirement; mechanism PORT-SPECIFIC. |
| python-receiver (planned) | unchanged | |
| wire-format | unchanged | |
| db-schema | unchanged | `endpoint_secrets.public_key` already present; this change populates it at create time. |

## Lockstep / lag

PORT-SPECIFIC mechanism — ports MAY lag. The cross-port CONTRACT outcome (a `v1a` endpoint's public key is retrievable via `publicJwks` without a prior rotation) is already carried by `key-management` *Current public signing keys are retrievable*; this change makes the TypeScript reference port satisfy it from endpoint creation rather than only after the first rotation.
