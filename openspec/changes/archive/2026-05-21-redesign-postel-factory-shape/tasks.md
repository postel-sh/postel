## 1. Author the spec deltas

- [ ] 1.1 Write `proposal.md`.
- [ ] 1.2 Write `specs/api-surface-typescript/spec.md` delta — MODIFIED + ADDED requirements.

## 2. Implementation

- [ ] 2.1 Add strategy modules under `typescript/packages/core/src/strategies/` — `verify.ts` (Secret/PublicKey/Keyset), `dedup.ts` (InMemoryDedup), `signing.ts` (HmacV1/Ed25519V1a), `retry.ts` (ExponentialBackoff/LinearBackoff/Custom), `workers.ts` (InProcess/BullMQ/PgBoss), `kms.ts` (AwsKms/GcpKms/Vault/PlaintextKms).
- [ ] 2.2 Add `NotImplementedError` class for unimplemented outbound runtime methods.
- [ ] 2.3 Rewrite `typescript/packages/core/src/postel.ts` — new factory with `observability?/outbound?/inbound?` shape, conditional types narrowing the returned instance, outbound methods throwing `NotImplementedError`, inbound methods delegating to `@postel/edge`.
- [ ] 2.4 Rewrite `typescript/packages/core/src/index.ts` — public surface exports (Postel + strategies + errors + types).
- [ ] 2.5 Rewrite `typescript/packages/core/test/` for the new shape — factory tests, conditional-optionality type assertions, verifier composition (single + array), `NotImplementedError` runtime throws, strategy factory return shapes.
- [ ] 2.6 Rewrite `typescript/packages/core/README.md` for the new API.

## 3. Light docs updates

- [ ] 3.1 Add a brief addendum to `decisions/0012-package-granularity.md` noting the factory uses sub-namespaces.

## 4. Validation and archive

- [ ] 4.1 `openspec validate redesign-postel-factory-shape --strict` green.
- [ ] 4.2 `openspec archive redesign-postel-factory-shape -y` — applies deltas to `openspec/specs/api-surface-typescript/spec.md`.
- [ ] 4.3 Update `scripts/spec-drift-deferred.txt` based on what tests now cover.
- [ ] 4.4 `node scripts/check-spec-drift.mjs` green (or Windows-safe equivalent — pre-existing path-separator bug).
- [ ] 4.5 `openspec validate --all` green.
- [ ] 4.6 `node scripts/check-edge-bundle.mjs` still green (edge untouched, ≤ 50 KB).
- [ ] 4.7 `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint` green inside `typescript/`.
