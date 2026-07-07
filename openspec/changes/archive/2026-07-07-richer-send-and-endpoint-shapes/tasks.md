# Tasks

## 1. Spec

- [ ] 1.1 MODIFY `sender` — RENAME *Send is non-blocking and returns a MessageId* → *Send is non-blocking and returns a SendResult* (rewritten around `{ id, reused }`); MODIFY *Idempotent send by client-supplied key* (same `id`, `reused: true` on the duplicate).
- [ ] 1.2 MODIFY `endpoint-management` — *Endpoint CRUD* full serializable round-trip on create/get/list/update + function-shaped-field exclusion; *Per-endpoint metadata field* anchored in the same read shape.
- [ ] 1.3 MODIFY `compliance` — track the renamed `sender` requirement title in the v0.2.0 contract-set table.

## 2. Core public API

- [ ] 2.1 `outbound.ts`: add `SendResult`; `OutboundApi.send` returns `Promise<SendResult>`; enrich the `Endpoint` interface (`types`, `channels`, `retryPolicy`, `headers`, `allowHttp`, `maxInflight`, `http`, `circuitBreaker`, `autoDisable`, `createdAt`, `updatedAt`).
- [ ] 2.2 `sender/send.ts`: `sendImpl` returns `SendResult` (stops discarding `InsertOrReuseResult.reused`; non-idempotent path reports `reused: false`).
- [ ] 2.3 `sender/endpoint/crud.ts`: `toPublicEndpoint` projects the full record; plain-record `headers` pass through, callable `headers` (and `filter`/`transform`/`signing`) stay off.
- [ ] 2.4 Export `SendResult` from the `@postel/core` root.

## 3. Callers

- [ ] 3.1 `@postel/compliance-driver`: `/control/send` destructures `id` (response body stays `{ messageId }`).
- [ ] 3.2 Update every `.send(` call site that consumes the return value across `typescript/packages/**` tests.
- [ ] 3.3 Verify `@postel/admin` endpoint routes carry the richer body (pass-through; no code change expected).

## 4. Tests

- [ ] 4.1 Sender tests renamed/extended: requirement title verbatim for the renamed requirement; idempotent send asserts `reused: false` then `reused: true` with the same `id`.
- [ ] 4.2 Endpoint CRUD tests: create round-trips every accepted serializable field across create/get/list; update returns the effective endpoint; function-shaped options stay off the read shape.

## 5. Docs

- [ ] 5.1 `docs/content/docs/outbound/send.mdx` — send-result snippet and idempotency prose.
- [ ] 5.2 `docs/content/docs/get-started/quickstart.mdx`, `docs/content/docs/storage/*.mdx`, `docs/content/docs/outbound/*` endpoint pages, and `docs/app/(home)/page.tsx` where they show the return value or the endpoint shape.

## 6. Verify + archive

- [ ] 6.1 `openspec validate richer-send-and-endpoint-shapes`; `openspec archive richer-send-and-endpoint-shapes -y`.
- [ ] 6.2 `mise run check:all`; in `typescript/`: `pnpm typecheck && pnpm test && pnpm lint && pnpm build`; `mise run docs:typecheck`.
- [ ] 6.3 PR referencing #83 and the `sender` / `endpoint-management` capability specs.
