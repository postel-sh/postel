# Tasks

## 1. Spec

- [x] 1.1 api-surface-typescript: ADD *Per-source event schema validation*; MODIFY *Structured error classes* (add `EventValidation`/`EVENT_VALIDATION`).
- [x] 1.2 receiver: MODIFY *Verify returns parsed event or structured error* (+`EVENT_VALIDATION`); MODIFY *Framework adapters gate verification...* (+`EVENT_VALIDATION → 422`).

## 2. Core

- [x] 2.1 `standard-schema.ts` (inlined Standard Schema v1); `EventValidation`/`EVENT_VALIDATION`; `InboundSource.schema` + `EventOf` + validate-in-`verify`; export `StandardSchemaV1`/`EventValidation`/`EventOf`. zod added as devDependency only.

## 3. @postel/http + @postel/admin

- [x] 3.1 `EVENT_VALIDATION → 422` in both `STATUS_BY_CODE`; `GateSource<TData>` / `handleInbound<TData>` carry the source payload type.

## 4. Adapters

- [x] 4.1 Typed handler surface (`c.var.postel` / `req.postel`), drop global augmentations, `getVerified()` reader; Fastify `.post(route, options, handler)` overload retained.

## 5. Tests + docs

- [ ] 5.1 core (valid → typed data; invalid → `EventValidation`; absent → unchanged), http (422), adapters (typed `req.postel`/`c.var.postel`, `getVerified`).
- [ ] 5.2 Docs: inbound schema section, web-adapters typed-handler + `getVerified`, errors reference, packages.

## 6. Verify + archive

- [ ] 6.1 `mise run check:all`, `turbo run typecheck test lint`, `mise run docs:typecheck`; archive; PR.
