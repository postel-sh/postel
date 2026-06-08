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

The library SHALL provide a framework-agnostic JWKS handler the host mounts at `/.well-known/webhooks-keys` (or a per-tenant equivalent). `jwksHandler({ keys })` serves a static key set; `@postel/http`'s `jwksFetchHandler(provider)` serves a **per-request** key set, so a `() => outbound.keys.publicJwks()` provider reflects key rotation without reconstructing the handler or redeploying. Each framework web adapter SHALL expose an `outbound.bindJwks(route?, provider?)` binding that mounts the handler onto the host app (Express, Fastify, Hono); the route defaults to `/.well-known/webhooks-keys` and the provider defaults to `() => outbound.keys.publicJwks()`. Fetch-native runtimes MAY use `jwksFetchHandler` directly, and a NestJS app mounts it in a controller.

**Conformance**: the served JWKS document, its `application/jwk-set+json` content type, the well-known mount path, and the GET/HEAD-only method handling are CONTRACT. The `outbound.bindJwks(route?, provider?)` binding shape per framework is PORT-SPECIFIC.

#### Scenario: Hono JWKS handler

- **WHEN** the host calls `HonoWebAdapter(postel, app).outbound.bindJwks()` (defaulting the route to `/.well-known/webhooks-keys` and the provider to `() => postel.outbound.keys.publicJwks()`)
- **THEN** a GET request to that path returns a JWKS JSON document

#### Scenario: Fastify JWKS handler

- **WHEN** the host calls `FastifyWebAdapter(postel, app).outbound.bindJwks()` to mount the handler at the well-known path
- **THEN** a GET request returns a JWKS JSON document

#### Scenario: Per-request key refresh

- **WHEN** the provider returns an updated key set on a later request
- **THEN** the served JWKS reflects the new keys without the handler being reconstructed

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

### Requirement: Current public signing keys are retrievable

The sender SHALL expose `outbound.keys.publicJwks({ tenantId?, tx? })` returning a JWKS document of the currently-publishable asymmetric (`v1a`) public keys: those whose secret status is `primary` or `verifying` and whose `not_after` (when set) has not passed. Each entry is a public-only JWK `{ kty: "OKP", crv: "Ed25519", x, kid, alg: "EdDSA" }`, deduplicated by `kid`. Private or symmetric key material MUST NOT appear. The `kid` is the RFC 7638 JWK thumbprint of the public key, so it matches the `kid` served in JWKS and the `webhook-key-id` stamped on outbound requests — letting a receiver `kid`-lookup across ports.

#### Scenario: publicJwks returns active public keys with kid

- **WHEN** an endpoint has a `primary` v1a secret with a stored public key
- **THEN** `outbound.keys.publicJwks()` returns a JWKS containing one key with `kty: "OKP"`, `crv: "Ed25519"`, `alg: "EdDSA"`, an `x`, and a `kid` equal to the RFC 7638 thumbprint of that public key
- **AND** no private key material appears in any entry

#### Scenario: Symmetric secrets are excluded

- **WHEN** an endpoint signs with an HMAC (`v1`) secret only
- **THEN** that endpoint contributes no entry to `publicJwks`

### Requirement: Outbound asymmetric signatures carry a key id

When signing an outbound request with a `v1a` (Ed25519) key, the sender SHALL stamp a `webhook-key-id` header equal to the public key's RFC 7638 JWK thumbprint — the same `kid` published via `publicJwks`. HMAC (`v1`) signatures SHALL NOT carry a `webhook-key-id`. This lets a receiver configured with a `Keyset` resolve the correct key by `kid`.

#### Scenario: v1a request stamps the key id

- **WHEN** the sender signs a request with a v1a key whose public key is known
- **THEN** the request carries `webhook-key-id` equal to the RFC 7638 thumbprint of that public key
- **AND** the same value appears as the `kid` of that key in `publicJwks`

#### Scenario: HMAC request carries no key id

- **WHEN** the sender signs a request with an HMAC (`v1`) secret
- **THEN** no `webhook-key-id` header is present

