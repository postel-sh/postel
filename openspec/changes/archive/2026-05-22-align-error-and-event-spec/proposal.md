## Why

Two small inconsistencies between `api-surface-typescript/spec.md` and the implementation surfaced during PR #30 review:

1. **Event shape:** the requirement `Public function signatures match Standard Webhooks event shape` describes events as `{ type, timestamp, data, channels?, version? }`, which reads as "only `channels` and `version` are optional." The actual public types (`@postel/edge`'s `WebhookEvent`, `@postel/core`'s `SendEvent`) make `timestamp` and `data` optional too — only `type` is required. Standard Webhooks treats body `timestamp` as a convention (the wire timestamp lives in the `webhook-timestamp` header) and `data` as optional for events with no payload (e.g., `user.deleted`). The spec prose drifted from the type-level contract.
2. **`NotImplementedError` class:** PR #30 adds `NotImplementedError` as a public error class thrown by `outbound.*` methods until the sender runtime lands in v0.2.0+. The `Structured error classes` requirement enumerates the class ↔ code mapping and says "every public failure mode SHALL throw a typed error class derived from `PostelError`", but `NotImplementedError` is missing from the table.

Both are documentation/contract drift, not behavioral changes. Fixing now keeps the spec the single source of truth.

## What Changes

- Update `Public function signatures match Standard Webhooks event shape`: clarify that only `type` is required; mark `timestamp` and `data` as optional in the prose, matching the TS types.
- Update `Structured error classes`: add `NotImplementedError` → `NOT_IMPLEMENTED` to the canonical class ↔ code mapping, with a brief note that `NOT_IMPLEMENTED` is an implementation-state code (raised when a port version has not yet implemented a typed method) rather than a webhook-protocol code.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api-surface-typescript`:
  - `Public function signatures match Standard Webhooks event shape` — prose clarifies which fields are required vs optional. No type-level change.
  - `Structured error classes` — adds one row to the canonical class ↔ code table.

### Removed Capabilities

None.

## Wire-format / DB-schema impact

Wire-format: unchanged. The spec realigns to the existing wire-format reality (`timestamp` and `data` are optional in the Standard Webhooks payload; the timestamp on the wire is the `webhook-timestamp` header).
DB-schema: unchanged.

## Impact

- `openspec/specs/api-surface-typescript/spec.md` — two requirement bodies updated (applied via archive).
- `typescript/packages/edge/src/errors.ts` — adds `"NOT_IMPLEMENTED"` to the `PostelErrorCode` union.
- `typescript/packages/core/src/errors.ts` — `NotImplementedError` now extends `PostelError`, sets `code: "NOT_IMPLEMENTED"`.
- New test in `typescript/packages/core/test/postel-factory.test.ts` confirming `NotImplementedError instanceof PostelError` and `.code === "NOT_IMPLEMENTED"`.
- No wire-format or DB changes.
