# Tasks — align storage-layer capability with the storage-strategy ADR

## 1. Validate the delta

- [x] 1.1 `openspec validate align-storage-strategy --strict` is green.
- [x] 1.2 The delta spec describes 4 MODIFIED + 3 ADDED requirements with corresponding scenarios; the 2 unchanged requirements (`Tenant-scoped row-level access`, `Schema is a fixed set of canonical tables`) are NOT in the delta.

## 2. Archive (auto-syncs into main spec)

- [x] 2.1 Run `openspec archive align-storage-strategy -y`. Upstream OpenSpec applies the MODIFIED/ADDED requirements from the delta into `openspec/specs/storage-layer/spec.md`.
- [x] 2.2 Confirm `openspec/specs/storage-layer/spec.md` now reflects the new requirements (Postgres support, SQLite support, BYO storage interface, Migrations runnable, Adapter matrix, Host transaction passthrough, Optional storage capabilities) plus the 2 unchanged ones.

## 3. Verify

- [x] 3.1 `mise run check:all` is green post-archive.
