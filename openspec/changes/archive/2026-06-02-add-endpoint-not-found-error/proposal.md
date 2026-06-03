## Why

The forthcoming admin HTTP router must return `404` when an endpoint id is unknown. Today `endpoints.get` and `endpoints.update` throw a plain `Error("endpoint not found: …")` whose only signal is the message string — and the `api-surface-typescript` *No string matching on errors* requirement forbids discriminating on message. There is no typed not-found error in the `PostelError` hierarchy, so a spec-clean 404 is impossible without message-sniffing.

## What Changes

- Add `EndpointNotFound` (`code: "ENDPOINT_NOT_FOUND"`) to the `PostelError` hierarchy and the canonical class↔code table.
- `endpoints.get` SHALL throw `EndpointNotFound` when the id is absent; `endpoints.update`'s URL re-validation SHALL throw it when the target endpoint is missing.
- `@postel/http`'s exhaustive error→status policy maps `ENDPOINT_NOT_FOUND` → 404 (adding the code forces the mapping at compile time).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`api-surface-typescript`** — MODIFIED *Structured error classes*: add the `EndpointNotFound` ↔ `ENDPOINT_NOT_FOUND` row to the canonical table.
- **`endpoint-management`** — MODIFIED *Endpoint CRUD*: reads/updates of an unknown id surface the typed `EndpointNotFound` error.

## Wire-format / DB-schema impact

Wire-format: unchanged.
DB-schema: unchanged.

## Impact

- `typescript/packages/core/src/errors.ts` — new `EndpointNotFound` class + union member; `src/index.ts` exports it.
- `typescript/packages/core/src/sender/endpoint/crud.ts` — `get` and `update` throw `EndpointNotFound`.
- `typescript/packages/http/src/error-policy.ts` — `ENDPOINT_NOT_FOUND` → 404.
- Tests: `core/test/errors.test.ts` (canonical table row), `core/test/dispatcher.test.ts` (not-found case).
