## 1. Error class

- [x] 1.1 Add `EndpointNotFound` (`code: "ENDPOINT_NOT_FOUND"`) to `errors.ts` and the `PostelErrorCode` union; export from `src/index.ts`.

## 2. Throw sites

- [x] 2.1 `sender/endpoint/crud.ts` — `get` and the `update` URL re-validation throw `EndpointNotFound`.

## 3. Error policy

- [x] 3.1 `@postel/http` `error-policy.ts` — map `ENDPOINT_NOT_FOUND` → 404 (forced by the exhaustive `Record<PostelErrorCode, number>`).

## 4. Tests

- [x] 4.1 `core/test/errors.test.ts` — add `EndpointNotFound` to the canonical table (covers *Structured error classes*).
- [x] 4.2 `core/test/dispatcher.test.ts` — `endpoints.get` of an unknown id throws `EndpointNotFound` (covers *Endpoint CRUD*).

## 5. Verify + archive

- [x] 5.1 `openspec validate add-endpoint-not-found-error --strict`.
- [x] 5.2 `pnpm --filter @postel/core test typecheck` + `@postel/http` typecheck; root `pnpm lint`.
- [x] 5.3 `mise run check:all`.
- [x] 5.4 `openspec archive add-endpoint-not-found-error -y`.
