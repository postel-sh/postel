## Why

Inbound sources already get a first-class typed-payload story: an `InboundSource` MAY declare `schema` (Standard Schema v1), and `verify()` validates `event.data` against it and returns a typed result. Outbound has no equivalent — `postel.outbound.send<TData = unknown>(event)` is a caller-supplied generic with zero runtime enforcement. `data` is written straight to the outbox row unvalidated. This asymmetry is exactly where producers make mistakes: a typo'd `type`, a malformed `data` payload, no compile-time signal either way. Producers deserve the same guarantee consumers already have.

## What Changes

- **Outbound event registry**: `createPostel({ outbound: { events: { "user.created": userCreatedSchema } } })` — an optional map from event `type` string to a Standard Schema v1 schema. Reuses the existing inlined `StandardSchemaV1` interface (`standard-schema.ts`); no new runtime dependency.
- **Send-time validation**: when `send()` is called with a `type` present in the registry, `sendImpl` validates `event.data` against the registered schema (via `schema["~standard"].validate`) before writing the outbox row. On validation failure, throws `EventValidation` (the same structured error class the inbound side already throws) rather than persisting a malformed row.
- **End-to-end typing**: `send()`'s `TData` is inferred from the registered schema's output type for the given literal `type`, mirroring inbound's `EventOf<S>`. Unregistered `type` strings remain fully permissive (`TData` defaults to `unknown`, no validation attempted) — additive, non-breaking, incrementally adoptable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sender`: ADDED requirement for send-time event schema validation against an optional per-type registry, mirroring the receiver-side "Per-source event schema validation" requirement.
- `api-surface-typescript`: ADDED requirement for the `outbound.events` registry config shape and `send()`'s schema-derived typing; MODIFIED "Structured error classes" to note `EventValidation` is now also thrown from the send path (class/code unchanged, new throw site).

## Wire-format / DB-schema impact

Wire-format: unchanged (validation happens before serialization; rejected sends never reach the wire). DB-schema: unchanged (validation happens before the outbox row is written; no new columns).

## Impact

- `@postel/core`: `outbound.ts` gains an `events` registry option on `OutboundConfig`/`createPostel`'s outbound slot, and a schema-derived conditional type for `send()`'s `TData`, mirroring `EventOf<S>`. `sender/send.ts`'s `sendImpl` gains a validation step that looks up the registry by `event.type` and throws `EventValidation` on mismatch. No new exports beyond what already exists (`EventValidation` is already exported).
- Docs: `docs/content/docs/outbound/` gains an events-registry example alongside the existing inbound schema docs.
- Tests: new send-time validation tests mirroring `verify.test.ts`'s schema tests, added to `sender.test.ts` or a new `outbound-schema.test.ts`.
