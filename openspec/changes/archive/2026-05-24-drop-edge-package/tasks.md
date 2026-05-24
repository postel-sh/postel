## 1. Spec deltas

- [ ] 1.1 Write `proposal.md`.
- [ ] 1.2 Write `specs/receiver/spec.md` delta — REMOVED Edge bundle size budget; REMOVED Edge runtime portability; MODIFIED Verify returns parsed event or structured error (purpose paragraph rewrite captured here per OpenSpec convention — purpose is part of the modified spec).
- [ ] 1.3 Write `specs/api-surface-typescript/spec.md` delta — MODIFIED Conditional optionality of outbound and inbound.
- [ ] 1.4 Write `specs/distribution-packaging-typescript/spec.md` delta — MODIFIED Package map.
- [ ] 1.5 Write `specs/compliance/spec.md` delta — MODIFIED Suite identity, MODIFIED v0.1.0 initial test scope, MODIFIED v0.1.0 explicit out-of-scope.
- [ ] 1.6 Write `specs/standard-webhooks-compliance/spec.md` delta — MODIFIED Compliance test suite.
- [ ] 1.7 Write `specs/storage-layer/spec.md` delta — MODIFIED Helpers package for adapter authors, MODIFIED Host transaction passthrough.

## 2. VISION + ADR

- [ ] 2.1 Update `VISION.md`: drop the Edge/serverless engineer persona row, drop edge-runtime from in-scope, replace 1.0 done criterion #1 (renumber the list), drop the Cloudflare Worker reference application from §6, rewrite the §1 problem-statement bullet that frames edge support as Postel's differentiator vs Svix / Hookdeck.
- [ ] 2.2 Add `decisions/0013-drop-edge-package-and-runtime-targeting.md` documenting the decision and listing which forward-looking claims in ADRs 0001 / 0010 / 0011 / 0012 it supersedes.

## 3. Code move

- [ ] 3.1 Move `typescript/packages/edge/src/*` into `typescript/packages/core/src/`. Merge `errors.ts` files. Move `internal/`.
- [ ] 3.2 Move `typescript/packages/edge/test/*` into `typescript/packages/core/test/`.
- [ ] 3.3 Rewrite `typescript/packages/core/src/inbound.ts` to import from local modules instead of `@postel/edge`.
- [ ] 3.4 Rewrite `typescript/packages/core/src/index.ts` to export the relocated names directly (drop the `@postel/edge` re-export block).
- [ ] 3.5 Drop the `@postel/edge` workspace dependency from `typescript/packages/core/package.json`.
- [ ] 3.6 Update `typescript/packages/core/tsup.config.ts` if needed to include the new source files.
- [ ] 3.7 Update `typescript/packages/frameworks/hono/src/index.ts` + `package.json` — switch `@postel/edge` to `@postel/core`.
- [ ] 3.8 Update `typescript/packages/storage/standalone-pg/src/index.ts` + `package.json` — switch `@postel/edge` to `@postel/core`. Update tests + tsup config.
- [ ] 3.9 Update `typescript/packages/storage/standalone-sqlite/src/index.ts` + `package.json` — same.
- [ ] 3.10 Delete `typescript/packages/edge/` entirely.
- [ ] 3.11 `pnpm install` to regenerate the lockfile.

## 4. Tooling + CI

- [ ] 4.1 Delete `scripts/check-edge-bundle.mjs`.
- [ ] 4.2 Remove any reference to that script from `mise.toml`.
- [ ] 4.3 Update `.github/workflows/compliance-suite.yml`: rename `edge-smoke` job, change `pnpm --filter` target from `@postel/edge` to `@postel/core`, drop the `scripts/check-edge-bundle.mjs` path filter, rename the `Build @postel/edge` step.
- [ ] 4.4 Update `typescript/scripts/smoke-receiver.mjs` import + build target.
- [ ] 4.5 Update `typescript/scripts/reference-receiver.mjs` import + build target.
- [ ] 4.6 Update `scripts/spec-drift-deferred.txt`: the header text mentions "api-surface-typescript surface beyond `@postel/edge`" — rephrase.

## 5. Docs site

- [ ] 5.1 Delete `docs/content/docs/guides/cloudflare-workers.mdx`.
- [ ] 5.2 Delete `docs/content/docs/concepts/edge-runtimes.mdx`.
- [ ] 5.3 Update `docs/content/docs/concepts/meta.json` to drop the edge-runtimes entry.
- [ ] 5.4 Update `docs/content/docs/guides/index.mdx` to drop the Cloudflare Workers entry.
- [ ] 5.5 Edit `docs/content/docs/why.mdx`, `index.mdx`, `get-started.mdx`, `api/index.mdx`, `concepts/{idempotency,raw-bytes,key-rotation,index}.mdx` to remove `@postel/edge` and edge-runtime references.
- [ ] 5.6 Edit `docs/app/(home)/page.tsx` landing snippets.
- [ ] 5.7 Edit `docs/README.md`.
- [ ] 5.8 Update `docs/scripts/build-api-reference.mjs` — TypeDoc input pointing at `@postel/edge` switches to `@postel/core`.

## 6. Cross-cutting

- [ ] 6.1 Update `README.md` (root) — drop edge-runtime / `@postel/edge` mentions.
- [ ] 6.2 Update `typescript/AGENTS.md` — drop edge package guidance.
- [ ] 6.3 Update `compliance/README.md` and `compliance/CHANGELOG.md` — `@postel/edge` → `@postel/core`.
- [ ] 6.4 Update `compliance/vectors/jwks/public-only.yaml` if any comment names `@postel/edge`.

## 7. Validation + archive

- [ ] 7.1 `openspec validate drop-edge-package --strict` green.
- [ ] 7.2 `pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint` green inside `typescript/`.
- [ ] 7.3 `mise run check:all` green (spec validate + spec schema validate + spec drift).
- [ ] 7.4 `mise run docs:build` and `mise run docs:typecheck` green.
- [ ] 7.5 `openspec archive 2026-05-24-drop-edge-package -y` — applies deltas to the main capability specs.
- [ ] 7.6 Re-run `openspec validate --all` green after archive.
