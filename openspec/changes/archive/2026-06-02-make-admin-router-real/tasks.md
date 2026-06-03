## 1. Router

- [x] 1.1 `@postel/admin` — `adminRouter(postel, { authorize, resolveTenant? })` Fetch router: route table over `OutboundApi`, default-deny auth, tenant scoping (404-no-leak), error→status map, retry-policy normalization, function-field rejection.

## 2. Framework mounts

- [x] 2.1 `fetchToExpress` (`@postel/express`) + `fetchToFastify` (`@postel/fastify`); Hono mounts the Fetch router natively.

## 3. Tests + spec + drift

- [x] 3.1 `@postel/admin` tests — name *Admin HTTP handlers* and *Admin authorization predicate* (CRUD, replay, keys, missing→404, invalid→422, default-deny 403, denied decision, cross-tenant 404). Express/Fastify bridge tests.
- [x] 3.2 `observability` MODIFIED *Admin HTTP handlers*.
- [x] 3.3 Remove *Admin HTTP handlers* + *Admin authorization predicate* from `scripts/spec-drift-deferred.txt`.

## 4. Docs

- [x] 4.1 New `docs/content/docs/outbound/admin.mdx`; `reference/packages.mdx` marks `@postel/admin` available.

## 5. Verify + archive

- [x] 5.1 `openspec validate make-admin-router-real --strict`.
- [x] 5.2 typecheck + test + build (admin + express + fastify); root `pnpm lint`.
- [x] 5.3 `mise run check:all`.
- [x] 5.4 `openspec archive make-admin-router-real -y`.
