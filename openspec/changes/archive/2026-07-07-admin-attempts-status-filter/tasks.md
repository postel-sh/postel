# Tasks

## 1. Spec

- [x] 1.1 MODIFY `observability` *Admin HTTP handlers* — `?status=` filter on `GET /messages/:id/attempts`; ADD scenario *Filter attempts by status via admin router*.

## 2. Admin HTTP

- [x] 2.1 `@postel/admin`: parse `?status=` (repeatable/CSV via `csvParam`) in the attempts branch and filter the `outbound.messages.attempts(id)` result.

## 3. Tests + docs

- [x] 3.1 Admin router test naming the requirement: mixed-status attempt history, `?status=failed` returns only failed attempts.
- [x] 3.2 Docs: `docs/content/docs/outbound/admin.mdx` route table + `docs/content/docs/outbound/messages.mdx` HTTP-projection sentence mention the attempts `?status=` filter.

## 4. Verify + archive

- [x] 4.1 `openspec validate admin-attempts-status-filter --strict`; admin package typecheck/test/lint; `mise run docs:typecheck`.
- [x] 4.2 `openspec archive admin-attempts-status-filter -y`; `mise run check:all`.
- [x] 4.3 PR referencing #81 (routes themselves landed via #80/PR #100).
