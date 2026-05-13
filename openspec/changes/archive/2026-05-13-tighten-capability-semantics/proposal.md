# Proposal — tighten capability-spec semantics and resolve cross-capability overlap

## Why

The recent multi-lens audit surfaced a cluster of localized quality issues across the capability specs. None blocks validation, but each will surface during implementation:

- An internal contradiction in `retry-policy`'s auto-disable scenario.
- A misplaced requirement (`Replay safety contract` lives in `retry-policy` but belongs in `replay-reconciliation`).
- A duplicate requirement in `sender` (the host-transaction property is stated twice).
- Definitional gaps around worker leases (mentioned but never specified).
- An orphan scenario in `storage-layer` (covers `@postel/storage-helpers` but lives under `Host transaction passthrough`).
- A vague performance budget in `observability` (`≤ 10ms` with no p50/p99/hardware context).
- Filter/transform behavior duplicated and subtly divergent between `sender` and `filtering-transformation`.
- An explicit error-class ↔ error-code mapping missing from `api-surface-typescript` (the receiver spec lists SCREAMING_SNAKE codes; api-surface lists PascalCase classes).
- Endpoint deletion cascade semantics silent in `endpoint-management`.
- HTTPS override flag named but not specified.
- JWKS shape specified in three places; no single source of truth.

## What Changes

- **MODIFIED** `retry-policy` `Endpoint auto-disable` — name the canonical default ("100% failures over a rolling 24h window, minimum 50 attempts"); pin one threshold in the scenario.
- **REMOVED** `retry-policy` `Replay safety contract` — belongs in `replay-reconciliation`.
- **ADDED** `replay-reconciliation` `Replay safety contract` — moved from `retry-policy`.
- **ADDED** `replay-reconciliation` `Default replay throughput` — pins a default for the throttle.
- **REMOVED** `sender` `Outbox writes are part of the host transaction` — duplicates `Send participates in the host transaction (outbox pattern)`.
- **REMOVED** `sender` `Per-endpoint payload transformation` — overlaps with `filtering-transformation`'s `Transform produces body to send`; `sender` should defer to `filtering-transformation` for the contract and only own the outcome status names.
- **REMOVED** `sender` `Per-endpoint payload filter` — same reason; deferred to `filtering-transformation`.
- **MODIFIED** `sender` `At-least-once delivery guarantee` — explicit reference to the lease mechanism (which is owned by storage-layer).
- **ADDED** `storage-layer` `Worker lease lifecycle` — owns the lease contract: default duration, renewal cadence, expiry / reclamation semantics.
- **MODIFIED** `storage-layer` `Host transaction passthrough` — removes the orphan helpers-package scenario (split out into a new requirement).
- **ADDED** `storage-layer` `Helpers package for adapter authors` — captures the orphan content as its own requirement.
- **MODIFIED** `observability` `Health check endpoint` — adds measurement context (p99, reference hardware, excluding network).
- **ADDED** `endpoint-management` `Endpoint deletion semantics` — cascade behavior for in-flight retries, audit-trail preservation, dead-letter handling.
- **MODIFIED** `endpoint-management` `URL validation at create time` — specifies the `allowHttp` option for the HTTPS-only default.
- **MODIFIED** `api-surface-typescript` `Structured error classes` — explicit class ↔ code mapping (PascalCase class name ↔ SCREAMING_SNAKE `code` property).
- **MODIFIED** `standard-webhooks-compliance` `JWKS discovery extension` — declared as the canonical source of the JWKS shape; `key-management` and `receiver` cross-reference rather than redefine.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `retry-policy` — 1 MODIFIED + 1 REMOVED.
- `replay-reconciliation` — 2 ADDED.
- `sender` — 3 REMOVED + 1 MODIFIED.
- `storage-layer` — 1 MODIFIED + 2 ADDED.
- `observability` — 1 MODIFIED.
- `endpoint-management` — 1 MODIFIED + 1 ADDED.
- `api-surface-typescript` — 1 MODIFIED.
- `standard-webhooks-compliance` — 1 MODIFIED.

## Wire-format / DB-schema impact

- **Wire format**: unchanged.
- **DB schema**: unchanged. The lease contract this change adds is already implied by the `messages.reserved_by`, `messages.reserved_at`, `messages.lease_expires_at` columns in the DDL; this change formalizes the semantics, not the storage shape.

## Impact

- **Code**: none yet (pre-implementation).
- **Tests**: the dedup atomicity scenario (added in the prior `align-specs-with-canonical-artifacts` change) now matches the canonical contract. Tests written for the relocated `Replay safety contract` requirement land under `replay-reconciliation` rather than `retry-policy`.
- **Stakeholders**: maintainer; future contributors writing the worker, retry loop, replay verbs, and TS error class hierarchy.
