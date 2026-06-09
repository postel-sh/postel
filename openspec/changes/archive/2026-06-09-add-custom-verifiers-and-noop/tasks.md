# Tasks

## 1. Spec

- [ ] 1.1 ADD `api-surface-typescript` *Custom verifiers and the Noop escape hatch [PORT-SPECIFIC]*: `Verifier` is an open contract; `Noop()` provided. Leave *Verifier strategy composition* and `receiver` untouched.

## 2. Implementation

- [ ] 2.1 `@postel/core` `strategies/verify.ts` — `Verifier` becomes `{ verify(rawBody, headers, options?): Promise<VerifyResult> }`; `Secret`/`PublicKey`/`Keyset` delegate to core `verify()`; add `Noop()` (parse envelope via `bodyToText`/`parseEvent`, `matchedSecretIndex: 0`).
- [ ] 2.2 `@postel/core` `inbound.ts` — `attempt()` calls `v.verify(rawBody, headers, options)`; remove `verifierToSecretOrKeyset` and the now-unused `SecretOrKeyset`/`RawSecret` imports. Keep the empty-array guard, `TimestampTooOld` short-circuit, `SignatureInvalid` aggregation, schema validation, and `onSuccess`/`onFailure`.
- [ ] 2.3 Export `Noop` from `strategies/index.ts` and the `@postel/core` barrel.

## 3. Tests

- [ ] 3.1 New `typescript/packages/core/test/custom-verifier.test.ts` with a describe naming the requirement verbatim (`Custom verifiers and the Noop escape hatch [PORT-SPECIFIC]`): custom verifier accepts/rejects (`matchedVerifierIndex` 0); custom verifier composed in an array yields index 1; `Noop()` accepts an unauthenticated request; `Noop()` throws `MalformedHeader` on a non-envelope body.

## 4. Docs

- [ ] 4.1 Update `docs/content/docs/inbound/verify.mdx` (custom verifiers + `Noop()` sections), `inbound/index.mdx` (feature-table rows), `inbound/signing.mdx` (contract is open), and `reference/packages.mdx` if it enumerates the factory list.

## 5. Verify

- [ ] 5.1 `mise run check:all`; in `typescript/` run `mise run test`, `mise run typecheck`, `mise run lint`; `mise run docs:typecheck`.
- [ ] 5.2 Archive the change (`openspec archive add-custom-verifiers-and-noop -y`) and open the PR.
