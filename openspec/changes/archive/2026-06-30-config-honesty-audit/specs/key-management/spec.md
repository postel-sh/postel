## MODIFIED Requirements

### Requirement: Encryption at rest with KMS adapter

Stored secrets SHALL be encrypted at rest using envelope encryption. A KMS adapter interface MUST be provided with built-in adapters for AWS KMS, GCP KMS, and HashiCorp Vault. A plaintext-with-warning adapter MAY be used in dev only.

**Interim (TypeScript port):** envelope encryption has not shipped. Configuring a built-in KMS adapter (`AwsKms()` / `GcpKms()` / `Vault()`) therefore throws `NotImplementedError` at construction rather than silently storing secrets in plaintext. `PlaintextKms()` is the only accepted strategy and is the shipped storage behavior; omitting `kms` is equivalent. The factory names stay on the public surface so adopters can wire them ahead of the runtime landing. See *Unimplemented config slots fail fast at construction* in `api-surface-typescript`.

#### Scenario: Production KMS

- **WHEN** the library is configured with the AWS KMS adapter
- **THEN** secrets stored in `endpoint_secrets` are encrypted with a data key wrapped by AWS KMS

### Requirement: Ephemeral keys via auto-rotation

The library SHALL support an "ephemeral keys" mode where signing keys auto-rotate every N hours. The new keys MUST be published via JWKS so receivers stay in sync without manual coordination.

**Interim (TypeScript port):** timer-driven rotation has not shipped (it lands with the scheduler), so the `outbound.ephemeralKeys` config slot fails fast — configuring it throws `NotImplementedError`. See *Unimplemented config slots fail fast at construction* in `api-surface-typescript`.

#### Scenario: Auto-rotate every 12h

- **WHEN** ephemeral mode is configured with 12-hour rotation
- **THEN** every 12 hours a new key becomes primary and the old key is demoted to verify-only and eventually removed
- **AND** the JWKS document is updated to reflect the new primary
