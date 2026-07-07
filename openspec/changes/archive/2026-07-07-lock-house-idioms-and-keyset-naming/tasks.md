# Tasks

## 1. Spec + ADR

- [x] 1.1 MODIFY `api-surface-typescript` *All writes accept an optional transaction parameter* — tx rides in the options bag; ADD *House API idioms*.
- [x] 1.2 MODIFY `receiver` *Timestamp window enforcement* (duration strings, injectable clock) and *JWKS consumer* (`createJwksKeyset`).
- [x] 1.3 Write `decisions/0015-house-api-idioms.md` capturing the four locked idioms.

## 2. Core renames (at source, no `as` re-exports)

- [x] 2.1 `types.ts`: `Secret` → `SecretValue`, `Keyset` → `JwksKeyset`, `SecretOrKeyset` → `SecretOrJwksKeyset`; sweep `verify.ts`, `sign-fixture.ts`.
- [x] 2.2 `keyset.ts`: `createKeyset` → `createJwksKeyset`; sweep `strategies/verify.ts`.
- [x] 2.3 `outbound.ts`: re-use the storage `MessageId` alias (single definition).
- [x] 2.4 `index.ts`: drop every `as`-renamed re-export; export `SecretValue`, `JwksKeyset`, `SecretOrJwksKeyset`, `createJwksKeyset`, `Unsubscribe`, single `MessageId`.

## 3. Idiom sweep

- [x] 3.1 `outbound.ts` + `sender/endpoint/crud.ts`: merge `create` / `update` runtime arg into the options bag (`EndpointCreateOptions & { tx? }`).
- [x] 3.2 `inbound.ts`: `tolerance: number | string` via `ttlToSeconds`; `now` → `clock?: Clock`; generalize `ttl.ts` error text.
- [x] 3.3 `types.ts` / `verify.ts`: `VerifyOptions.now` → `clock?: Clock`.

## 4. Tests

- [x] 4.1 New `core/test/house-idioms.test.ts` naming *House API idioms* (duration tolerance, clock injection, no `as`-renamed root exports).
- [x] 4.2 Duration-string window test naming *Timestamp window enforcement*.
- [x] 4.3 Sweep existing tests (core, frameworks, http) from `now:` fixtures to `clock:` and to the renamed exports.

## 5. Docs

- [x] 5.1 `docs/content/docs/inbound/verify.mdx` configuration shape: `tolerance` durations, `clock`.
- [x] 5.2 Verify the `Keyset({ jwksUri })` factory snippets (key-rotation, signing, verify, quickstart, landing page) still hold — the factory keeps its name.

## 6. Verify + archive

- [x] 6.1 `openspec validate lock-house-idioms-and-keyset-naming`; archive; `mise run check:all`.
- [x] 6.2 TypeScript chain: `pnpm typecheck && pnpm test && pnpm lint && pnpm build`.
- [x] 6.3 PR closing #86 and #87.
