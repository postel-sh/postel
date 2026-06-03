## Why

Creating an endpoint never mints its signing material. Only `rotateSecret` inserts secrets through the public API, so a freshly created Ed25519 (`v1a`) endpoint has no published JWKS key until its first rotation: `outbound.keys.publicJwks()` surfaces only secrets carrying `publicKey`, which today is set solely by `rotateSecret`. Hosts must reach past the public API and hand-insert an `EndpointSecretRecord` to get a working signer — the gap the JWKS key-source change explicitly deferred.

## What Changes

- **`endpoints.create` provisions the initial primary signing secret** from the resolved signing strategy — the create-time `signing` option, else the outbound `signing` default, else HMAC (`v1`) — in the same transaction as the endpoint row. For a `v1a` strategy the stored secret carries the public key (raw Ed25519 bytes decoded from the `whpk_` half), so `publicJwks()` surfaces the endpoint's key immediately, with no rotation required.
- **`EndpointCreateOptions` gains `provisionSecret?: boolean` (default `true`).** Hosts that manage signing material externally — KMS-only flows, fixture-driven test harnesses, the compliance driver — pass `provisionSecret: false` so create writes no secret (preserving today's behavior).
- **The keypair-storage logic is extracted** into a shared `mintSecretMaterial(algorithm)` helper reused by `rotateSecret` (no behavior change to rotation).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`endpoint-management`** — ADD *Endpoint creation provisions the initial signing secret* (PORT-SPECIFIC mechanism; the CONTRACT outcome — a `v1a` endpoint's public key is retrievable via `publicJwks` without a prior rotation — is anchored by `key-management` *Current public signing keys are retrievable*).

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: unchanged — `endpoint_secrets.public_key` already exists (added by the JWKS key-source change); this change only populates it earlier, at create time.

## Impact

- `typescript/packages/core/src/sender/endpoint/crud.ts` — resolve signing + provision the initial secret atomically with the endpoint insert; honor the `provisionSecret` opt-out.
- `typescript/packages/core/src/sender/keys/material.ts` (new) — `mintSecretMaterial(algorithm)` + `newSecretId()`.
- `typescript/packages/core/src/sender/keys/rotation.ts` — reuse the shared helper (no behavior change).
- `typescript/packages/core/src/outbound.ts` — `EndpointCreateOptions.provisionSecret?`; thread `config.signing` into endpoint defaults.
- `typescript/packages/compliance-driver/src/server.ts` — pass `provisionSecret: false` (fixtures own the secret material; keeps the compliance suite's signatures unchanged).
- `docs/content/docs/outbound/endpoints.mdx` — document initial-secret provisioning on create + the `provisionSecret` opt-out.
