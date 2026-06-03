## 1. Shared handler

- [x] 1.1 `@postel/http` — `jwksFetchHandler(provider)` (per-request JWKS Fetch handler over core `jwksHandler`); `@postel/http/node` — `writeResponseToNodeRes`.

## 2. Adapter bindings

- [x] 2.1 `.jwks(provider)` on `honoAdapter` (Fetch), `expressAdapter` + `fastifyAdapter` (Node bridge).

## 3. Tests + spec + docs

- [x] 3.1 `@postel/http` jwks test (serves keys, per-request refresh, 405) + one `.jwks()` test per adapter — all name *JWKS endpoint mounter*.
- [x] 3.2 `key-management` MODIFIED *JWKS endpoint mounter*.
- [x] 3.3 Docs: key-rotation `.jwks()` now ships.

## 4. Verify + archive

- [x] 4.1 `openspec validate add-jwks-adapter-bindings --strict`.
- [x] 4.2 typecheck + test + build (http + 3 adapters); root `pnpm lint`.
- [x] 4.3 `mise run check:all`.
- [x] 4.4 `openspec archive add-jwks-adapter-bindings -y`.
