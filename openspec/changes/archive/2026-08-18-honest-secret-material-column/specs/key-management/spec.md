## MODIFIED Requirements

### Requirement: Encryption at rest with KMS adapter

Stored secrets SHALL be encrypted at rest using envelope encryption. A KMS adapter interface MUST be provided with built-in adapters for AWS KMS, GCP KMS, and HashiCorp Vault. A plaintext-with-warning adapter MAY be used in dev only.

The canonical `endpoint_secrets` table SHALL NOT claim encryption it does not perform. The signing-material column is named `material` (not `encrypted_value` or any other name implying encryption), and a per-row `encryption` discriminator column records what protection, if any, was applied to that row (`'plaintext' | 'aws-kms' | 'gcp-kms' | 'vault'`, matching the `KmsStrategy` vocabulary). This gives a future KMS adapter a landing zone — it populates `encryption` with the strategy used and stores the envelope-encrypted bytes in `material` — without ever requiring a column rename or a claim that predates the capability shipping.

**Interim (TypeScript port):** envelope encryption has not shipped. Configuring a built-in KMS adapter (`AwsKms()` / `GcpKms()` / `Vault()`) therefore throws `NotImplementedError` at construction rather than silently storing secrets in plaintext. `PlaintextKms()` is the only accepted strategy and is the shipped storage behavior; omitting `kms` is equivalent. Every `endpoint_secrets` row written today carries `encryption = 'plaintext'` — an honest record that `material` holds the raw key bytes, not an encrypted envelope. The factory names stay on the public surface so adopters can wire them ahead of the runtime landing. See *Unimplemented config slots fail fast at construction* in `api-surface-typescript`.

#### Scenario: Production KMS

- **WHEN** the library is configured with the AWS KMS adapter
- **THEN** secrets stored in `endpoint_secrets` are encrypted with a data key wrapped by AWS KMS

#### Scenario: Column naming reflects actual encryption state

- **WHEN** a contributor or adopter inspects the canonical `endpoint_secrets` schema
- **THEN** the signing-material column is named `material`, not `encrypted_value` or any other name implying encryption is applied
- **AND** an `encryption` column on the same row records the actual protection applied (`'plaintext'` today)

#### Scenario: Plaintext storage is discriminated, not hidden

- **WHEN** a secret is minted and stored under the shipped `PlaintextKms()` (or an omitted `kms` config)
- **THEN** the persisted `endpoint_secrets` row has `encryption = 'plaintext'`
- **AND** nothing in the schema, the stored row, or the API claims encryption that does not happen
