# Tasks — align capability specs with canonical artifacts

## 1. Validate the delta

- [x] 1.1 `openspec validate align-specs-with-canonical-artifacts --strict` is green.
- [x] 1.2 Each MODIFIED requirement's header text matches the existing main-spec header exactly (whitespace-insensitive).

## 2. Archive (auto-syncs into main specs)

- [x] 2.1 Run `openspec archive align-specs-with-canonical-artifacts -y`.
- [x] 2.2 Confirm each affected capability spec reflects the new content:
  - `endpoint-management`: state vocabulary now `active | disabled | circuit-open`; `re-enabled` is a transition reason.
  - `api-surface-typescript`: "TypeScript port" (not "reference implementation").
  - `storage-layer`: canonical-tables list includes `_postel_meta`; count says seven.
  - `multi-tenancy`: rate-limit persisted in `tenants.metadata.rateLimit`; new naming convention requirement.
  - `receiver`: Redis dedup framed as optional, not MUST.
  - `standard-webhooks-compliance`: signing requirement is testable via vector interop.
  - `sender`: new requirement pins `attempts.status` casing.

## 3. Verify

- [x] 3.1 `mise run check:all` is green post-archive.
