# Tasks

## 1. Spec

- [ ] 1.1 MODIFY `api-surface-typescript` — *Structured error classes* (drop the two dead rows), *Unimplemented config slots fail fast at construction* (add per-endpoint `maxInflight`).
- [ ] 1.2 MODIFY `receiver` — *Verify returns parsed event or structured error* (drop `RAW_BYTES_MISMATCH_DETECTED` from the enum), *Framework adapters gate verification and map protocol errors to HTTP status* (drop the status-table row).

## 2. Core

- [ ] 2.1 `errors.ts`: remove `IdempotencyKeyConflict`, `RawBytesMismatchDetected`, and their codes from `PostelErrorCode`; `index.ts`: drop both from exports.
- [ ] 2.2 `internal/config-guards.ts`: add `assertMaxInflightWired(maxInflight, where)`, same shape as `assertHttpWired`.
- [ ] 2.3 `sender/endpoint/crud.ts`: call `assertMaxInflightWired` in `create` and `update`.

## 3. Dependents (compiler-enforced)

- [ ] 3.1 `@postel/http` `error-policy.ts`: drop the two entries from `STATUS_BY_CODE`.
- [ ] 3.2 `@postel/admin` `index.ts`: drop the two entries from `STATUS_BY_CODE`.

## 4. Tests

- [ ] 4.1 `errors.test.ts`: drop the two canonical-table rows and their imports.
- [ ] 4.2 `error-policy.test.ts`: drop the `RawBytesMismatchDetected` assertion and import.
- [ ] 4.3 `config-audit.test.ts`: add `endpoint.maxInflight` to `CONFIG_FIELD_MAP` as `fails-fast`, extend the sorted-keys assertion, add the create/update fail-fast scenario test.
- [ ] 4.4 `dispatcher.test.ts`: drop `maxInflight: 10` from the "Create round-trips every accepted serializable field" test (it no longer round-trips through the public API).

## 5. Docs

- [ ] 5.1 `docs/content/docs/reference/errors.mdx`: drop both classes from the hierarchy diagram, delete their class-reference sections, drop `IdempotencyKeyConflict` from "Reserved codes", fix the `SignatureInvalid` recovery note that references `RawBytesMismatchDetected`.
- [ ] 5.2 `docs/content/docs/inbound/raw-bytes.mdx`: delete "The detector" section.
- [ ] 5.3 `docs/content/docs/inbound/signing.mdx`, `inbound/index.mdx`, `inbound/verify.mdx`, `reference/http.mdx`: drop `RawBytesMismatchDetected` / `RAW_BYTES_MISMATCH_DETECTED` mentions.
- [ ] 5.4 `typescript/packages/http/README.md`, `typescript/packages/admin/README.md`: drop the same mentions.

## 6. Verify + archive

- [ ] 6.1 `openspec validate fix-inert-error-and-config-surfaces`; `openspec archive fix-inert-error-and-config-surfaces -y`; `mise run check:all`.
- [ ] 6.2 `pnpm -C typescript typecheck test lint build` (or per-package equivalents for `core`, `http`, `admin`).
- [ ] 6.3 PR referencing `api-surface-typescript` and `receiver`; `Closes #131`.
