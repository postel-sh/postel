## Why

Adopters routinely validate webhook payloads after verifying the signature — checking that `event.data` has the fields they expect before acting on it. Today they hand-roll that downstream of `verify()`, untyped: `verify()` returns `event.data: unknown`, so every handler casts. There is no first-class way to declare "this source's `data` looks like X" and get both runtime validation and end-to-end types.

## What Changes

- **Per-source `schema`**: an inbound source MAY declare `schema` implementing the [Standard Schema](https://github.com/standard-schema/standard-schema) v1 interface (zod ≥3.24, valibot, arktype, …). `@postel/core` inlines the Standard Schema interface and takes **no runtime dependency** on any schema library (preserving its zero-dependency guarantee per `distribution-packaging-typescript`).
- **Validation inside `verify()`**: when a `schema` is present, `verify()` validates `event.data` against it **after** the signature check. On mismatch it throws a new `EventValidation` error (code `EVENT_VALIDATION`); the framework gate maps that to HTTP **422**.
- **End-to-end typing**: the verified result's `TData` is inferred from the schema's output via `const` config inference, so `postel.inbound.<source>.verify(...)` and the framework adapters' typed handlers (`c.var.postel` / `req.postel`) carry the payload type with no wrapper.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`api-surface-typescript`** — ADDED *Per-source event schema validation* (the `schema` field + schema-output typing); MODIFIED *Structured error classes* to add `EventValidation` / `EVENT_VALIDATION` to the class↔code table.
- **`receiver`** — MODIFIED *Verify returns parsed event or structured error* to add `EVENT_VALIDATION` to the failure list; MODIFIED *Framework adapters gate verification and map protocol errors to HTTP status* to add `EVENT_VALIDATION → 422` to the canonical table.

## Wire-format / DB-schema impact

Wire-format: unchanged (payload structure and signing are untouched; `EVENT_VALIDATION → 422` is a new gate status outcome, not a wire-format change). DB-schema: unchanged.

## Impact

- `@postel/core`: new `standard-schema.ts` (inlined interface), `EventValidation` error, `InboundSource.schema` + `EventOf` typing + validation in `verify`. New exports: `StandardSchemaV1`, `EventValidation`, `EventOf`. zod added as a **devDependency only** (for the inference typecheck).
- `@postel/http` + `@postel/admin`: `EVENT_VALIDATION → 422` added to each `STATUS_BY_CODE`; `GateSource`/`handleInbound` carry the source `TData`.
- Framework adapters: typed handler surface (`c.var.postel` / `req.postel`), global `declare module`/`declare global` augmentations removed, new `getVerified()` reader for the primitive path.
- Docs + tests updated accordingly.
