# Proposal — align capability specs with canonical artifacts (DDL, ADRs, wire format)

## Why

A multi-lens audit of `openspec/specs/` surfaced a cluster of mismatches between capability specs and the canonical artifacts they're supposed to track:

- The endpoint state vocabulary in `endpoint-management` (`active | disabled | re-enabled`) doesn't match the SQL DDL's CHECK list (`active | disabled | circuit-open`).
- `api-surface-typescript` still refers to TypeScript as "the reference implementation" — left over from before [ADR 0005](../../../decisions/0005-polyglot-staged-rollout.md) reframed every port as first-class.
- `storage-layer`'s canonical-tables requirement says "six tables + dead_letter view" but the DDL has seven (it includes `_postel_meta` for schema versioning).
- `multi-tenancy.setRateLimit` is normative but never says where the rate-limit value is persisted (the `tenants` table has no rate-limit column).
- `receiver` declares Redis as a MUST-exist dedup adapter, contradicting [ADR 0001](../../../decisions/0001-library-shape.md)'s no-Redis-dependency stance.
- `standard-webhooks-compliance` has a "wraps the official signing library where possible" requirement that's unverifiable as written.
- Casing drift on `tenant_id` / `tenantId` between DDL columns, API surface, and metric labels.
- Casing drift between `ssrf_blocked` (DDL attempts.status enum value) and `SSRF_BLOCKED` (sender error reason).

None block validation — all 13 specs currently pass — but each will cause real friction the moment we start writing implementation code that's supposed to honor both the spec and the canonical artifact.

## What Changes

- **MODIFIED** `endpoint-management` `Endpoint state machine with audit trail` — adopt DDL's `active | disabled | circuit-open` vocabulary; clarify that `re-enabled` is a transition *reason* (in `endpoint_state_transitions.reason`), not a state.
- **MODIFIED** `api-surface-typescript` `createPostel factory returns the library instance` — "TypeScript reference implementation" → "TypeScript port", per ADR 0005.
- **MODIFIED** `storage-layer` `Schema is a fixed set of canonical tables` — add `_postel_meta` to the table list; update the scenario count from "six" to "seven".
- **MODIFIED** `multi-tenancy` `Per-tenant rate limits` — specify that rate-limit configuration is persisted in `tenants.metadata` JSONB.
- **MODIFIED** `receiver` `Idempotency dedup helper` — reframe Redis as an optional host-supplied adapter (not MUST-exist), aligning with ADR 0001.
- **MODIFIED** `standard-webhooks-compliance` `Wraps the official signing library` — replace the unverifiable "where possible" clause with a testable contract: produced signatures MUST verify byte-identically against the official `standardwebhooks` JS library across published test vectors.
- **ADDED** `multi-tenancy` `Naming convention for tenant scoping` — one canonical statement of the convention (`tenant_id` for DB columns and metric labels, `tenantId` for public TS API) so the rest of the corpus has somewhere to point.
- **ADDED** `sender` `Attempt status enum casing` — pin the canonical casing for `attempts.status` values (kebab-case in DDL: `dead-letter`, `failed-permanent`, `ssrf-blocked`; matching free-text reason fields use the same casing) so the previously snake-case `ssrf_blocked` outlier gets normalized.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `endpoint-management` — 1 MODIFIED.
- `api-surface-typescript` — 1 MODIFIED.
- `storage-layer` — 1 MODIFIED.
- `multi-tenancy` — 1 MODIFIED + 1 ADDED.
- `receiver` — 1 MODIFIED.
- `standard-webhooks-compliance` — 1 MODIFIED.
- `sender` — 1 ADDED.

## Wire-format / DB-schema impact

- **Wire format**: unchanged.
- **DB schema**: the `attempts.status` enum CHECK list will need `ssrf_blocked` → `ssrf-blocked` adjusted in a future DDL migration. This change records the spec intent; the migration lands when storage code does. Not in scope for this change (no `db-schema-delta.sql` artifact).

## Impact

- **Code**: none yet (pre-implementation).
- **Tests**: future tests must match the new state vocabulary and casing conventions.
- **Stakeholders**: maintainer; future contributors writing the first storage adapters and the TS API.
