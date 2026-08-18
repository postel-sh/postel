## Why

Issue #145: `api-surface-typescript/spec.md:154` says the library SHALL provide an Effect-TS adapter that is "a first-class layer, not a callback-style afterthought", and VISION persona 4 is the Effect user. `@postel/effect` is a 1-line private placeholder — the only placeholder backed by a hard SHALL (the spec's Interim note acknowledges the deferral, but it is scheduled honesty, not a real answer).

## What Changes

- **api-surface-typescript**
  - RENAME + MODIFY `Effect-TS layer` → `Effect-TS layer [PORT-SPECIFIC]` — drop the `Interim` note now that the adapter has shipped, and tag it PORT-SPECIFIC per [ADR 0008](../../../decisions/0008-conformance-levels.md) (Effect-TS has no cross-port analogue): a `PostelLive(config)` `Layer` builds the Postel instance and Effect-manages its worker lifecycle (`start()` on acquire, `stop()` on the layer's `Scope` release); `PostelTag` identifies the service in `Context`; `send`/`replay`/`messages.{get,attempts,list}`/`inbound.<source>.verify` are exposed as `Effect`-returning methods instead of Promise-returning ones; `PostelError`/`ConfigurationError`/`NotImplementedError` are the adapter's typed error channel rather than rejections.
- **distribution-packaging-typescript**
  - MODIFY `Package map` — move `@postel/effect` out of the placeholder bullet into the Auxiliary bullet as a real package.
  - MODIFY `Empty placeholder packages are pre-alpha and unpublished` — drop `@postel/effect` from the named placeholder set (now three: `@postel/test`, `@postel/bun`, `@postel/cli`); the guard test (`typescript/packages/core/test/distribution-packaging.test.ts`) already detects this dynamically, so this is a documentation-accuracy fix, not a behavior change.

## Capabilities

### Modified Capabilities

- `api-surface-typescript` — one MODIFIED requirement (`Effect-TS layer`), dropping the Interim note and specifying the shipped shape.
- `distribution-packaging-typescript` — two MODIFIED requirements (placeholder-set narrowing, package-map bullet move).

## Wire-format / DB-schema impact

None. `@postel/effect` is a TypeScript-only ergonomics layer over `@postel/core`'s existing runtime; no new wire fields, DB columns, or cross-port behavior.

## Impact

- `typescript/packages/effect/` — real `PostelLive`/`PostelTag`/`PostelEffectApi` implementation, tests, `private` removed, `effect` added as a peer dependency.
- `typescript/packages/core/test/distribution-packaging.test.ts` — the dynamically-detected placeholder set no longer includes `@postel/effect` (asserted by the existing guard test, unchanged logic).
- `docs/content/docs/` — new page targeting the Effect persona; `reference/packages.mdx` updated from stub/planned framing to the real adapter (rule 8).
