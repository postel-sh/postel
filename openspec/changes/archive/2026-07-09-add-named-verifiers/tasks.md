## 1. Core types and composition logic

- [x] 1.1 Add `VerifierMap = Record<string, Verifier>` to `typescript/packages/core/src/inbound.ts` (or re-export from `strategies/verify.ts`, matching where `Verifier` itself lives).
- [x] 1.2 Widen `InboundSource.verify` to `Verifier | ReadonlyArray<Verifier> | VerifierMap`.
- [x] 1.3 Add `matchedVerifier?: string` to `ComposedVerifyResult`.
- [x] 1.4 In `verifySource()`, normalize `source.verify` into an ordered `ReadonlyArray<{ name?: string; verifier: Verifier }>`: array → no names; single `Verifier` (detect via `typeof verify.verify === "function"`) → single-element, no name; otherwise → `Object.entries` of the map, in insertion order. Replace the existing `Array.isArray` normalization with this.
- [x] 1.5 In the composition loop, set `matchedVerifierIndex: i` and, only when `name !== undefined`, `matchedVerifier: name` on the successful result.

## 2. Tests

- [x] 2.1 Add "Named-map verifier reports the matched name" / "Named-map verifier composes with cross-scheme migration" / "Array and single-verifier forms carry no matchedVerifier key" / "Named-map ConfigurationError rethrow" tests to `typescript/packages/core/test/postel-factory.test.ts`, alongside the existing "Verifier strategy composition" describe block.
- [x] 2.2 Confirm existing array/single-verifier tests in `postel-factory.test.ts`, `custom-verifier.test.ts`, and `house-idioms.test.ts` are unaffected (no `matchedVerifier` key leaks in for those forms).

## 3. Docs

- [x] 3.1 Add a named-map example to `docs/content/docs/inbound/key-rotation.mdx` alongside the existing array-based HMAC rotation example, showing `matchedVerifier` in the result.

## 4. Verification

- [x] 4.1 Run `mise run check:all` at the repo root.
- [x] 4.2 Run the `@postel/core` test/lint/typecheck/build chain; run the framework-adapter packages' tests too since they consume `ComposedVerifyResult`.
