## Why

`MalformedHeader` — a wire-format error mapped to HTTP 400 by `@postel/http` and `@postel/admin` — is today also thrown for developer configuration mistakes (empty verifier array, `dedup()` without a ttl, a malformed `secretOrKeyset`). An integrator following the documented pattern `if (err instanceof PostelError) return 4xx` therefore masks their own config bugs as client errors instead of crashing loudly in development. Changing the error contract is breaking, so it must land before the M3 contract freeze (#85).

## What Changes

- **BREAKING** New `ConfigurationError` in `@postel/core`, extending the platform `Error` directly — deliberately NOT a `PostelError` subclass and NOT in `PostelErrorCode` — with `name = "ConfigurationError"` and a stable `code = "CONFIGURATION_ERROR"` (same shape as the existing `NotImplementedError` implementation-state error). Because it is outside `PostelError`, the `@postel/http` gate and `@postel/admin` error handlers do not map it to a 4xx: it falls through to the 500/throw path unchanged.
- **BREAKING** Developer-mistake throw sites migrate from `MalformedHeader` to `ConfigurationError`: inbound source with no verifiers configured, `dedup()` called without a ttl, ttl parsing (`ttlToSeconds`), empty secret array, non-`string | string[] | Keyset` `secretOrKeyset`, receiver-side secret carrying the ed25519-private prefix, `createKeyset` when `fetch` is unavailable in the runtime, and `signFixture` with a non-HMAC secret.
- The inbound verifier composition loop rethrows `ConfigurationError` immediately (as it already does `TimestampTooOld`) instead of swallowing it into `SignatureInvalid`.
- Wire-parsing sites are untouched: missing/unparsable headers, malformed signature tuples, malformed event envelopes, malformed JWKS documents, and runtime JWKS-fetch failures keep throwing `MalformedHeader`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`api-surface-typescript`** — MODIFY *Structured error classes* to define the configuration-error category (`ConfigurationError`, code `CONFIGURATION_ERROR`, outside `PostelError`/`PostelErrorCode`); MODIFY *Verifier strategy composition* to rethrow `ConfigurationError` from the composition loop; MODIFY *Custom verifiers and the Noop escape hatch* to qualify the swallow-into-`SignatureInvalid` language accordingly.

## Wire-format / DB-schema impact

Wire-format: unchanged — configuration errors never cross the wire; the `MALFORMED_HEADER` wire vocabulary is untouched. DB-schema: unchanged.

## Impact

- `@postel/core`: new exported `ConfigurationError`; throw sites migrated in `inbound.ts`, `verify.ts`, `keyset.ts`, `ttl.ts`, `sign-fixture.ts`; verifier loop rethrow in `inbound.ts`.
- `@postel/http` / `@postel/admin`: no code change — `ConfigurationError` is invisible to `PostelError`-keyed status maps by construction; covered by tests.
- Tests asserting `MalformedHeader` at migrated sites updated; new scenarios covered 1:1.
- Docs: error-reference and inbound pages updated where they imply config mistakes throw `MalformedHeader`.
