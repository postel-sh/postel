# key-management Specification

## Purpose

Generation, storage, and rotation of signing material. Symmetric (HMAC, `whsec_`) and asymmetric (Ed25519, `whsk_` / `whpk_`) keypair generation; per-endpoint priority-ordered secret arrays with `primary` / `verifying` / `expiring` lifecycle states; rotation APIs with explicit overlap windows; KMS-backed encryption at rest; JWKS publication for the asymmetric scheme; and optional ephemeral keys that auto-rotate on a schedule.

## Requirements
### Requirement: Symmetric secret generation

The library SHALL provide `postel.keys.generateSymmetric()` returning a Standard Webhooks-formatted symmetric secret with the `whsec_` prefix.

#### Scenario: Generated secret format

- **WHEN** `keys.generateSymmetric()` is called
- **THEN** the result starts with `whsec_` and contains base64 entropy of at least 256 bits

### Requirement: Asymmetric keypair generation

The library SHALL provide `postel.keys.generateAsymmetric()` returning `{ private, public }` Ed25519 keypairs with `whsk_` and `whpk_` prefixes respectively.

#### Scenario: Generated keypair format

- **WHEN** `keys.generateAsymmetric()` is called
- **THEN** the result has a `private` field starting with `whsk_` and a `public` field starting with `whpk_`

### Requirement: Endpoint holds a priority-ordered secret array

Each endpoint SHALL hold an ordered array of secrets. Signing SHALL use the head of the array. Verification (when checked by the receiver) MUST accept any secret in the array.

#### Scenario: Sign with primary

- **WHEN** an endpoint has `[secretA, secretB]` and dispatches a message
- **THEN** the outgoing signature is computed with `secretA`

### Requirement: Rotation API with overlap window

The library SHALL provide `postel.endpoints.rotateSecret(endpointId, { keepPreviousFor: '24h' })`. The new secret becomes primary; the old secret is demoted to verify-only and scheduled for removal at the end of the window.

#### Scenario: Rotate keeping old

- **WHEN** `rotateSecret(id, { keepPreviousFor: '24h' })` is called
- **THEN** new attempts sign with the new secret
- **AND** the old secret remains in the array for 24 hours, then is removed

### Requirement: JWKS endpoint mounter

The library SHALL provide `postel.jwksHandler({ tenantId? })` — a framework-agnostic handler the host mounts at `/.well-known/webhooks-keys` (or per-tenant equivalent). Adapters for Express/Hono/Bun MUST be provided.

#### Scenario: Hono JWKS handler

- **WHEN** the host mounts `postel.jwksHandler()` on Hono at `/.well-known/webhooks-keys`
- **THEN** a GET request to that path returns a JWKS JSON document

### Requirement: JWKS publishes only public keys

In asymmetric mode, the JWKS endpoint SHALL publish only public keys, each with `kid`, `alg`, key material, and an optional `not_after` field. Private keys MUST NEVER appear in JWKS output.

#### Scenario: Private key absent

- **WHEN** the JWKS document is fetched
- **THEN** no field contains the private key material; `private` is not present in any entry

### Requirement: Encryption at rest with KMS adapter

Stored secrets SHALL be encrypted at rest using envelope encryption. A KMS adapter interface MUST be provided with built-in adapters for AWS KMS, GCP KMS, and HashiCorp Vault. A plaintext-with-warning adapter MAY be used in dev only.

#### Scenario: Production KMS

- **WHEN** the library is configured with the AWS KMS adapter
- **THEN** secrets stored in `endpoint_secrets` are encrypted with a data key wrapped by AWS KMS

### Requirement: Ephemeral keys via auto-rotation

The library SHALL support an "ephemeral keys" mode where signing keys auto-rotate every N hours. The new keys MUST be published via JWKS so receivers stay in sync without manual coordination.

#### Scenario: Auto-rotate every 12h

- **WHEN** ephemeral mode is configured with 12-hour rotation
- **THEN** every 12 hours a new key becomes primary and the old key is demoted to verify-only and eventually removed
- **AND** the JWKS document is updated to reflect the new primary

