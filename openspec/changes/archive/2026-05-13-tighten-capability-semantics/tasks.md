# Tasks — tighten capability-spec semantics

## 1. Validate the delta

- [x] 1.1 `openspec validate tighten-capability-semantics --strict` is green.
- [x] 1.2 Each MODIFIED requirement's header text matches the existing main-spec header exactly. Each REMOVED requirement includes Reason + Migration.

## 2. Archive (auto-syncs into main specs)

- [x] 2.1 Run `openspec archive tighten-capability-semantics -y`.
- [x] 2.2 Confirm each affected capability spec reflects:
  - `retry-policy`: auto-disable threshold now pinned to "100% failures, ≥50 attempts in 24h"; `Replay safety contract` removed.
  - `replay-reconciliation`: `Replay safety contract` added (was previously in retry-policy); new default replay throughput.
  - `sender`: duplicate transaction requirement removed; filter/transform removed (now owned by `filtering-transformation`); at-least-once requirement now references storage-layer's lease lifecycle.
  - `storage-layer`: lease lifecycle added with 60_000ms default; helpers package requirement carved out; orphan scenario relocated.
  - `observability`: health-check requirement now specifies p99 + reference hardware + excluding network.
  - `endpoint-management`: URL validation specifies `allowHttp` option; deletion semantics added.
  - `api-surface-typescript`: structured-error-classes requirement now includes the explicit class ↔ code mapping table.
  - `standard-webhooks-compliance`: JWKS discovery is declared canonical; others cross-reference.

## 3. Verify

- [x] 3.1 `mise run check:all` is green post-archive.
