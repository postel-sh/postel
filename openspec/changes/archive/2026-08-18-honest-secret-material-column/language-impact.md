# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | `EndpointSecretRecord.encryptedValue` / `NewSecretMaterial.encryptedValue` renamed to `material`; new `encryption` discriminator field; all 8 storage adapters + testkit pick it up generically. |
| typescript-receiver | unchanged | |
| go-sender (planned) | unchanged | Must adopt the same `material` / `encryption` column naming when built (CONTRACT). |
| go-receiver (planned) | unchanged | |
| python-sender (planned) | unchanged | Must adopt the same `material` / `encryption` column naming when built (CONTRACT). |
| python-receiver (planned) | unchanged | |
| wire-format | unchanged | Secret material is never carried on the wire to receivers. |
| db-schema | modified | `endpoint_secrets.encrypted_value` renamed to `material`; new `encryption` column (`NOT NULL DEFAULT 'plaintext'`); `_postel_meta.schema_version` bumps to 7. |

## Lockstep / lag

The `material` / `encryption` column naming and the plaintext-until-KMS discriminator vocabulary are CONTRACT (verified by `@postel/compliance` once that suite lands). Unbuilt ports (Go, Python, Rust) MUST implement this naming when they add key-management/storage support — no lag permitted for a capability they don't yet have. KMS itself remains deferred and fail-fast across every port; this change only renames the honest landing zone it will populate.
