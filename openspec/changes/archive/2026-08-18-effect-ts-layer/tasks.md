## 1. Author the spec delta

- [x] 1.1 Write `proposal.md`.
- [x] 1.2 `specs/api-surface-typescript/spec.md` — MODIFY `Effect-TS layer`.
- [x] 1.3 `specs/distribution-packaging-typescript/spec.md` — MODIFY `Package map`; MODIFY `Empty placeholder packages are pre-alpha and unpublished`.

## 2. Implementation

- [x] 2.1 `typescript/packages/effect/src/index.ts` — `PostelTag`/`PostelLive` (Layer/Context for the Postel instance, Scope-managed worker lifecycle), `PostelEffectApi` (Effect-wrapped `send`/`replay`/`messages.{get,attempts,list}`/`inbound.<source>.verify`), `PostelErrors` typed error channel.
- [x] 2.2 `typescript/packages/effect/package.json` — remove `private: true`; add `@postel/core` dependency and `effect` peer dependency.
- [x] 2.3 `typescript/packages/effect/tsup.config.ts` — build config, `effect`/`@postel/core` external.
- [x] 2.4 `typescript/packages/effect/README.md` — usage docs.

## 3. Tests

- [x] 3.1 `typescript/packages/effect/test/effect-layer.test.ts` — layer acquisition/release lifecycle, typed error channel, send/verify/messages/replay via Effect.
- [x] 3.2 `typescript/packages/core/test/distribution-packaging.test.ts` — update the expected placeholder-name list (drop `@postel/effect`); the detection logic is unchanged (dynamic, not a hardcoded allowlist).

## 4. Docs (rule 8)

- [x] 4.1 `docs/content/docs/effect/index.mdx` (or equivalent) — real usage guide for the Effect persona.
- [x] 4.2 `docs/content/docs/reference/packages.mdx` — drop stale "planned"/placeholder framing for `@postel/effect`.

## 5. Validation and archive

- [ ] 5.1 `openspec validate effect-ts-layer --strict` green.
- [ ] 5.2 `openspec archive effect-ts-layer -y`.
- [ ] 5.3 `mise run check:all` green.
- [ ] 5.4 `pnpm -C typescript --filter @postel/effect test` and `pnpm -C typescript --filter @postel/core test` green.
