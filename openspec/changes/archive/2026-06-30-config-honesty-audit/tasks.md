## 1. Author the spec deltas

- [ ] 1.1 Write `proposal.md`.
- [ ] 1.2 `specs/api-surface-typescript/spec.md` — ADD `Unimplemented config slots fail fast at construction`; MODIFY `Outbound defaults are overridable per endpoint`.
- [ ] 1.3 `specs/observability/spec.md` — ADD `Logger pass-through for runtime events`; MODIFY `Configurable retention with automatic pruning`.
- [ ] 1.4 `specs/key-management/spec.md` — MODIFY `Encryption at rest with KMS adapter` + `Ephemeral keys via auto-rotation`.
- [ ] 1.5 `specs/sender/spec.md` — MODIFY `TLS verification by default` + `DNS rebinding protection`.

## 2. Implementation

- [ ] 2.1 `outbound.ts` — fail fast on `kms` (non-`plaintext`), `retention`, `ephemeralKeys`, `http.tls`, `http.dns` in `buildOutboundRuntime`.
- [ ] 2.2 `crud.ts` — reuse the `http.tls` / `http.dns` fail-fast assertion in `create` / `update`.
- [ ] 2.3 `postel.ts` — `ObservabilityConfig` → `{ logger?: Logger }`; add `Logger` / `LogEvent`; forward emitter events to the logger.
- [ ] 2.4 `index.ts` — export `Logger`, `LogEvent`.

## 3. Tests

- [ ] 3.1 `config-audit.test.ts` — fail-fast throws for each phantom slot (org + per-endpoint); passes for `PlaintextKms` + wired config.
- [ ] 3.2 `config-audit.test.ts` — logger pass-through receives a real dispatch event.
- [ ] 3.3 `config-audit.test.ts` — field→consumer / fails-fast mapping table (#78).

## 4. Docs (rule 8)

- [ ] 4.1 `docs/content/docs/outbound/index.mdx` — KMS row throws; Observability row forwards logger events.
- [ ] 4.2 `docs/content/docs/index.mdx` — realign the phantom-config sentence.

## 5. Validation and archive

- [ ] 5.1 `openspec validate config-honesty-audit --strict` green.
- [ ] 5.2 `openspec archive config-honesty-audit -y`.
- [ ] 5.3 `openspec validate --all` green.
- [ ] 5.4 `mise run check:all` green (spec-drift sees the two new requirements covered).
- [ ] 5.5 `pnpm -C typescript test` / `lint` / `build` green.
