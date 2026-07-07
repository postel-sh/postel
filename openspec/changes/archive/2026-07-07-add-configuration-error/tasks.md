# Tasks

## 1. Spec

- [ ] 1.1 MODIFY `api-surface-typescript` — *Structured error classes* (configuration-error category), *Verifier strategy composition* (loop rethrows `ConfigurationError`), *Custom verifiers and the Noop escape hatch* (qualified swallow language).

## 2. Core

- [ ] 2.1 `errors.ts`: add `ConfigurationError` (extends `Error`, `name = "ConfigurationError"`, `code = "CONFIGURATION_ERROR"`); export from `index.ts`.
- [ ] 2.2 Migrate throw sites: `inbound.ts` (no verifiers; dedup without ttl), `verify.ts` (empty secret array; non-`string|string[]|Keyset`; ed25519-private receiver secret), `keyset.ts` (missing runtime `fetch`), `ttl.ts` (all three throws), `sign-fixture.ts` (non-HMAC secret).
- [ ] 2.3 `inbound.ts` verifier loop: rethrow `ConfigurationError` immediately, like `TimestampTooOld`.

## 3. Tests

- [ ] 3.1 `errors.test.ts`: `ConfigurationError` shape scenarios (instanceof Error, not PostelError, code, name).
- [ ] 3.2 Cover migrated sites + loop rethrow; update tests that asserted `MalformedHeader` at migrated sites (`postel-factory.test.ts` ttl tests).
- [ ] 3.3 Confirm `@postel/http` / `@postel/admin` mapping unaffected (ConfigurationError falls through to 500/throw path).

## 4. Docs

- [ ] 4.1 Update `docs/content/docs/reference/errors.mdx` and inbound pages where config mistakes were implied to throw `MalformedHeader`.

## 5. Verify + archive

- [ ] 5.1 `openspec validate add-configuration-error`; `openspec archive add-configuration-error -y`; `mise run check:all`; typescript `pnpm typecheck test lint build`.
- [ ] 5.2 PR referencing the `api-surface-typescript` capability; `Closes #85`.
