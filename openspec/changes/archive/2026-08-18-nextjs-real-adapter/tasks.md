## 1. Author the spec delta

- [x] 1.1 Write `proposal.md`.
- [x] 1.2 `specs/distribution-packaging-typescript/spec.md` — MODIFY `Package map`; MODIFY `Empty placeholder packages are pre-alpha and unpublished`; MODIFY `Framework adapters share a framework-agnostic HTTP core`.

## 2. Implementation

- [x] 2.1 `typescript/packages/frameworks/nextjs/src/index.ts` — real `NextjsWebAdapter` facade (`inbound.<source>.post`/`.on`, `outbound.bindJwks`, `admin.bindAdminRoutes`) + `withWebhook` low-level primitive, over `@postel/http`'s `handleInbound`/`jwksFetchHandler` and `@postel/admin`'s `adminRouter`.
- [x] 2.2 `typescript/packages/frameworks/nextjs/package.json` — remove `private: true`; add `@postel/admin`/`@postel/core`/`@postel/http` dependencies.
- [x] 2.3 `typescript/packages/frameworks/nextjs/README.md` — usage docs.

## 3. Tests

- [x] 3.1 `typescript/packages/frameworks/nextjs/test/nextjs-adapter.test.ts` — sibling parity with the Hono adapter test suite (raw-byte preservation, gate + verified-result handoff, bad-signature 400, explicit-method binding, schema-typed result, low-level primitive, JWKS mounting, admin-router binding + authorize denial).
- [x] 3.2 `typescript/packages/core/test/distribution-packaging.test.ts` — update the expected placeholder-name list (drop `@postel/nextjs`); the detection logic is unchanged (dynamic, not a hardcoded allowlist).

## 4. Docs (rule 8)

- [x] 4.1 `docs/content/docs/web-adapters/nextjs.mdx` — real usage guide, replacing the stub.
- [ ] 4.2 `docs/content/docs/web-adapters/index.mdx`, `docs/content/docs/inbound/index.mdx`, `docs/content/docs/reference/packages.mdx` — drop stale "stub"/"planned" framing.

## 5. Validation and archive

- [ ] 5.1 `openspec validate nextjs-real-adapter --strict` green.
- [ ] 5.2 `openspec archive nextjs-real-adapter -y`.
- [ ] 5.3 `mise run check:all` green.
- [ ] 5.4 `pnpm -C typescript --filter @postel/nextjs test` and `pnpm -C typescript --filter @postel/core test` green.
