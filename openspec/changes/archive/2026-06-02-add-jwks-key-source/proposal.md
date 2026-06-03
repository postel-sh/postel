## Why

JWKS publishing has no key source. `generateAsymmetric()` persists nothing, `EndpointSecretRecord` stores only the private/symmetric value, and the dispatcher never stamps a key id — so a receiver using a `Keyset` (which looks up by the `webhook-key-id` header → JWK `kid`) has no way to learn the sender's current public keys, and `jwksHandler` has nothing to serve. The `.jwks()` adapter binding (a follow-up) cannot be implemented correctly until the sender can produce its current public keys with stable kids.

## What Changes

- **Store the public key**: `EndpointSecretRecord` gains an optional `publicKey` (raw Ed25519 bytes), set by `rotateSecret` for `v1a` secrets. Persisted via the `endpoint_secrets.public_key` column (DB-schema delta).
- **Stamp a key id**: outbound `v1a` requests carry `webhook-key-id` = the RFC 7638 JWK thumbprint of the public key (the same value the receiver matches against JWK `kid`).
- **Retrieve current public keys**: `outbound.keys.publicJwks({ tenantId?, tx? })` returns the active (`primary`/`verifying`, not-yet-expired) `v1a` public keys as a JWKS document — each `{ kty: "OKP", crv: "Ed25519", x, kid, alg: "EdDSA" }`, deduplicated by kid, never private material.

The kid scheme (RFC 7638 thumbprint) is a cross-port wire contract: any port's signer and JWKS publisher MUST derive the same kid from the same public key so receivers can `kid`-lookup across ports.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`key-management`** — ADD *Current public signing keys are retrievable* (`publicJwks`) and *Outbound asymmetric signatures carry a key id* (`webhook-key-id` = JWK thumbprint).

## Wire-format / DB-schema impact

Wire-format: unchanged in the AsyncAPI surface — `webhook-key-id` is the existing receiver-side key-id header (already read by `verify` for `Keyset` lookup); this change makes the sender populate it. No new wire field is introduced to the contract.
DB-schema: **modified** — `endpoint_secrets` gains a nullable `public_key` column (forward-only; see `db-schema-delta.sql`).

## Impact

- `typescript/packages/core/src/storage/types.ts` — `EndpointSecretRecord.publicKey?`.
- `src/sender/keys/rotation.ts` — store the v1a public key.
- `src/sender/dispatcher/headers.ts` — stamp `webhook-key-id` for v1a.
- `src/outbound.ts` — `keys.publicJwks(...)`.
- `src/internal/jwk.ts` + `src/internal/base64.ts` — `ed25519Kid` (RFC 7638 thumbprint), `ed25519Jwk`, `bytesToBase64Url`.
- `specs/db-schema/0002_endpoint_secret_public_key.sql` (from the delta).
- The in-memory `Storage` adapter carries the new field transparently; the `@postel/standalone-pg` / `@postel/standalone-sqlite` adapters are dedup-only and do not touch `endpoint_secrets`.
- Initial-secret provisioning remains host/test-driven (only `rotateSecret` inserts via the public API); a future change can add a provisioning API that sets `publicKey` on the first v1a secret.
