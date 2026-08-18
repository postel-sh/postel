## Why

Three pieces of advertised-but-inert public surface, same class as the M1 "config honesty" work (#78): `IdempotencyKeyConflict` and `RawBytesMismatchDetected` are exported `PostelError` subclasses with zero throw sites anywhere in the runtime, and `endpoints.create({ maxInflight })` is accepted and persisted but never read by the dispatcher or worker pool. Adopters writing catch blocks or reading the docs error table are guarding impossible paths or relying on protection that doesn't exist. (#131)

## What Changes

- **BREAKING** Remove `IdempotencyKeyConflict` (class, `IDEMPOTENCY_KEY_CONFLICT` code) from `@postel/core`. The `sender` spec has always defined idempotency-key collisions as `send()` returning `{ reused: true }`, never as a thrown error — there is no scenario, in any capability spec, that calls for this class to be thrown. It is dead forward-declared surface, not a deferred feature.
- **BREAKING** Remove `RawBytesMismatchDetected` (class, `RAW_BYTES_MISMATCH_DETECTED` code) from `@postel/core`. No compliance vector or spec scenario exercises a runtime-heuristic re-serialization detector; the actual conformant behavior for a re-serialized body (`receiver/raw-bytes/json-reserialized-reject`) is `SignatureInvalid`, which already ships. The docs' "The detector" section describing best-effort mutation detection is fiction and is deleted along with the class.
- `endpoints.create` / `endpoints.update` now throw `NotImplementedError` when `maxInflight` is set, joining the existing per-endpoint `http.tls` / `http.dns` fail-fast checks (`assertMaxInflightWired`, mirroring `assertHttpWired`). The field stays on the public type and the storage schema for when a per-endpoint concurrency cap ships.
- Both removed classes drop out of `PostelErrorCode`, the `@postel/http` and `@postel/admin` status-mapping records (TypeScript's exhaustive `Record<PostelErrorCode, number>` makes omission a compile error, so the two packages can't silently drift), and the docs error table / hierarchy diagram / package READMEs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`api-surface-typescript`** — MODIFY *Structured error classes* to drop `RawBytesMismatchDetected` / `IdempotencyKeyConflict` from the canonical class↔code table; MODIFY *Unimplemented config slots fail fast at construction* to add per-endpoint `maxInflight` to the fail-fast slot list with a new scenario.
- **`receiver`** — MODIFY *Verify returns parsed event or structured error* to drop `RAW_BYTES_MISMATCH_DETECTED` from the thrown-error enum; MODIFY *Framework adapters gate verification and map protocol errors to HTTP status* to drop the `RAW_BYTES_MISMATCH_DETECTED` → 400 row from the canonical status table.

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: unchanged — `maxInflight` stays a persisted column/field; only the accept-time guard changes.

## Impact

- `@postel/core`: `errors.ts` / `index.ts` drop both classes and codes; `internal/config-guards.ts` gains `assertMaxInflightWired`; `sender/endpoint/crud.ts` calls it from `create` and `update`.
- `@postel/http`, `@postel/admin`: `STATUS_BY_CODE` records shrink by two entries each (compiler-enforced).
- Tests: `errors.test.ts`, `error-policy.test.ts` drop the two canonical-table rows; `config-audit.test.ts` (#78 audit table) gains `endpoint.maxInflight` as a `fails-fast` entry plus a scenario test; `dispatcher.test.ts`'s "Create round-trips every accepted serializable field" test drops `maxInflight` from its round-trip assertion (it is no longer a silently-accepted field).
- Docs: `reference/errors.mdx` (hierarchy diagram, class reference, reserved-codes paragraph), `inbound/raw-bytes.mdx` ("The detector" section deleted), `inbound/signing.mdx`, `inbound/index.mdx`, `inbound/verify.mdx`, `reference/http.mdx`, and the `@postel/http` / `@postel/admin` READMEs.
