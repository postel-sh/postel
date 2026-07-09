## Why

`verify: [SecretA, SecretB]` reports which verifier matched via `matchedVerifierIndex: number` — a positional index that loses meaning the moment config order changes (adding a verifier, reordering during a migration). The same problem already exists one level down: `matchedSecretIndex` identifies which secret *inside* a single verifier matched, for the same reason (key rotation). Adopters who want to log or branch on "which credential matched" today have to hard-code index-to-meaning mappings that silently go stale.

## What Changes

- Inbound sources' `verify` slot MAY be a named map — `verify: { current: Secret(NEW), legacy: Secret(OLD) }` — alongside the existing `Verifier` and `ReadonlyArray<Verifier>` forms.
- When the map form is used, the verified result gains `matchedVerifier: string` — the key of the verifier that matched (e.g. `"legacy"`) — in addition to the existing `matchedVerifierIndex` (the map's iteration-order position, computed the same way an array's would be).
- The array and single-`Verifier` forms are unchanged: `matchedVerifierIndex` is still reported; `matchedVerifier` is absent (not `undefined`-valued — the key itself is missing) since there is no name to report.
- Purely additive: existing array/single-verifier configs and their result shape are untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api-surface-typescript`: MODIFIED "Verifier strategy composition" — adds the named-map `verify` form and the `matchedVerifier` result field.

## Wire-format / DB-schema impact

None. This is a config-shape and result-shape change entirely on the inbound verification path; nothing crosses the wire differently and nothing is persisted.

## Impact

- `@postel/core`: `inbound.ts` — `InboundSource.verify` gains the named-map form (`Record<string, Verifier>`); `ComposedVerifyResult` gains optional `matchedVerifier`; `verifySource()`'s composition loop normalizes all three forms (single, array, map) into an ordered list of `{ name?, verifier }` before iterating, so the existing first-match-wins, `ConfigurationError`/`TimestampTooOld`-rethrow, and failure-aggregation behavior is shared code, not duplicated per form.
- No new exports; `VerifierMap` type is exported alongside `Verifier` for hosts that want to type a map variable explicitly.
- Docs: `docs/content/docs/inbound/key-rotation.mdx` gains the named-map example alongside the existing array-based rotation example.
