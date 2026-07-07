# Tasks

## 1. Spec

- [ ] 1.1 MODIFY `endpoint-management` *Endpoint CRUD* — extend the function-shaped carve-out to `custom` retryPolicy and `http.fetch`; state null-vs-absent semantics.

## 2. Core

- [ ] 2.1 `sender/endpoint/crud.ts`: normalize `retryPolicy` (custom → `null`) and `http` (drop `fetch`) in `toPublicEndpoint`.
- [ ] 2.2 `outbound.ts`: type `Endpoint.retryPolicy` as the data-only strategy variants; `Endpoint.http` omits `fetch`.

## 3. Tests

- [ ] 3.1 Core read-shape test covers custom retryPolicy → `null` and `http` minus `fetch`.
- [ ] 3.2 Storage testkit: endpoint field-value round-trip case (create → get) run by every adapter.
- [ ] 3.3 Admin: assert `GET /endpoints/:id` carries the richer body (`createdAt`, `types`).

## 4. Docs + verify

- [ ] 4.1 `docs/content/docs/outbound/endpoints.mdx` read-shape section.
- [ ] 4.2 `openspec archive serializable-read-shape-carve-outs -y`; `mise run check:all`; TS chain; `mise run compliance:sender:ts`.
