## 1. Shared key material

- [x] 1.1 `sender/keys/material.ts` — `mintSecretMaterial(algorithm)` (HMAC value for `v1`; private value + raw `publicKey` for `v1a`, decoded from the `whpk_` half) and `newSecretId()`.
- [x] 1.2 Refactor `rotateSecret` to use `mintSecretMaterial` / `newSecretId` (no behavior change).

## 2. Provision on create

- [x] 2.1 Thread the outbound `signing` default into `EndpointDefaults` (`buildOutboundRuntime` → `buildEndpointApi`).
- [x] 2.2 `EndpointCreateOptions.provisionSecret?: boolean` (default `true`) in `outbound.ts`.
- [x] 2.3 In `crud.ts` create: resolve signing (`opts.signing` → org default → HMAC `v1`), and when provisioning is on, mint + insert the `primary` secret (with `publicKey` for `v1a`) atomically with the endpoint row.

## 3. Hosts that manage secrets externally

- [x] 3.1 `compliance-driver/src/server.ts` — pass `provisionSecret: false` on `endpoints.create` (fixtures own the secret material; keeps suite signatures unchanged).

## 4. Tests + spec

- [x] 4.1 `core/test/provision-secret.test.ts` — names *Endpoint creation provisions the initial signing secret* verbatim: v1a publishes via `publicJwks` with no rotation (per-endpoint and org-default arms); default `v1` HMAC secret on create (excluded from `publicJwks`); `provisionSecret: false` writes no secret.
- [x] 4.2 `endpoint-management` ADDED requirement (PORT-SPECIFIC, with Conformance note).

## 5. Docs (rule 8)

- [x] 5.1 `docs/content/docs/outbound/endpoints.mdx` — initial-secret provisioning on create + `provisionSecret` opt-out + v1a publishes via `publicJwks` without rotation.

## 6. Verify + archive

- [x] 6.1 `openspec validate provision-endpoint-initial-secret --strict`.
- [x] 6.2 `cd typescript && pnpm typecheck && pnpm test && pnpm lint && pnpm build`.
- [x] 6.3 `mise run check:all` + `mise run docs:typecheck` + sender compliance corpus.
- [x] 6.4 `openspec archive provision-endpoint-initial-secret -y`.
