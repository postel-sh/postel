## ADDED Requirements

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
