## 1. Storage

- [x] 1.1 `EndpointSecretRecord.publicKey?: Uint8Array` (storage/types.ts); `endpoint_secrets.public_key` column (db-schema-delta).

## 2. Key generation / rotation

- [x] 2.1 `rotateSecret` stores the raw public key for `v1a` secrets (decoded from the `whpk_` half of `generateAsymmetric()`).

## 3. Signing

- [x] 3.1 `internal/jwk.ts` — `ed25519Kid` (RFC 7638 thumbprint) + `ed25519Jwk`; `internal/base64.ts` — `bytesToBase64Url`.
- [x] 3.2 `signAndBuildHeaders` stamps `webhook-key-id` = `ed25519Kid(publicKey)` for v1a; HMAC carries none.

## 4. Read API

- [x] 4.1 `outbound.keys.publicJwks({ tenantId?, tx? })` — active v1a public keys as a deduped JWKS, public-only.

## 5. Tests + spec

- [x] 5.1 `core/test/jwks-publish.test.ts` — names *Current public signing keys are retrievable* and *Outbound asymmetric signatures carry a key id* (publicJwks shape/kid, HMAC excluded, stamped key-id == published kid).
- [x] 5.2 `key-management` ADDED requirements; `db-schema-delta.sql`.

## 6. Verify + archive

- [x] 6.1 `openspec validate add-jwks-key-source --strict`.
- [x] 6.2 `@postel/core` typecheck + test; root `pnpm lint`.
- [x] 6.3 `mise run check:all`.
- [x] 6.4 `openspec archive add-jwks-key-source -y`.
