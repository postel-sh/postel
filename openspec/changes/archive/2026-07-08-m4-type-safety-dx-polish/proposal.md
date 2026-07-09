## Why

Milestone **M4 — Type-safety & DX polish** collects five adopter-facing ergonomics gaps in the TypeScript port. None change the wire format or DB schema; all sharpen the developer experience and remove misleading failure modes. One of them (#89) is a public signature change, so it lands before the tag; the rest are additive.

- **#89** `postel.on(event, handler)` is untyped (`payload: unknown`), returns `void`, and the payload types aren't exported — the cheapest high-visibility win, but a signature change.
- **#90** `const config: PostelConfig = {…}; Postel(config)` erases `inbound`/`outbound` from the instance type, because the conditional types need the literal. The most confusing type-level failure a new adopter can hit.
- **#91** `health()` unconditionally returns `ok: true`, making it a misleading readiness probe.
- **#92** The Express gate returns an empty raw body when `req.body` isn't a `Buffer` (e.g. an upstream `express.json()` consumed it), silently degrading to "signature invalid" instead of naming the actual mistake.
- **#93** The multi-verifier loop collapses every failure into one `SignatureInvalid` carrying only the *last* verifier's error, so diagnosing which verifier rejected and why is archaeology.

## What Changes

- **BREAKING (#89)** `LifecycleApi.on` becomes generic over a `PostelEventMap` (`dead-letter` → `DeadLetterPayload`, `attempt` → `AttemptPayload`, `circuit-open`/`circuit-close` → `CircuitTransitionPayload`), correlating event name to payload type. `on` returns `Unsubscribe` (the existing idiom) instead of `void`; `off` is likewise typed. The payload types and `PostelEventMap` are exported from `@postel/core`. The event map is an interface so new events grow non-breaking.
- **(#90)** New `definePostelConfig()` identity helper in `@postel/core` — `<const C extends PostelConfig>(config: C): C` — that preserves the literal so the instance-type conditionals resolve. Documented in getting-started as the inline / `definePostelConfig` / `as const satisfies` rule.
- **(#91)** `health()` reports `ok: false` on a real unhealthy condition: a storage probe failure (`outboxDepth()` throws → storage unreachable) and, when configured, an outbox-depth threshold exceeded. Thresholds are configured under `observability.health` and documented. An unhealthy result carries a `reason`.
- **(#92)** The Express gate's raw-body reader throws a descriptive `ConfigurationError` — pointing at body-parser ordering — when `req.body` is not a `Buffer`/`Uint8Array`, instead of feeding an empty buffer into verification. Because `ConfigurationError` is outside `PostelError`, it bubbles as 5xx rather than mapping to a 400 signature failure.
- **(#93)** The inbound multi-verifier loop collects every rejecting verifier's error and exposes them on the thrown error as `errors: ReadonlyArray<{ verifierIndex, error }>` (plus a standard `AggregateError` `cause`). When **every** verifier rejects with `MalformedHeader`, the loop surfaces `MalformedHeader` itself rather than `SignatureInvalid` (both map to HTTP 400; this is a diagnostic refinement). `TimestampTooOld` and `ConfigurationError` keep their existing immediate-rethrow behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`api-surface-typescript`** — ADD *Typed lifecycle event emitter* (#89); ADD *`definePostelConfig` preserves literal config inference* (#90); MODIFY *Custom verifiers and the Noop escape hatch* so the Noop malformed-envelope path surfaces `MalformedHeader` with the originating error aggregated (#93).
- **`observability`** — MODIFY *Health check endpoint* to define the `ok: false` conditions (storage probe failure; configured outbox-depth threshold) and the `observability.health` thresholds (#91).
- **`receiver`** — ADD *Multi-verifier failures are aggregated* (#93); ADD *Consumed raw body surfaces a descriptive configuration error* (#92).

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: unchanged. All five items are library-surface ergonomics; no cross-the-wire behavior changes (the #93 unanimous-`MalformedHeader` refinement maps to the same HTTP 400 as before).

## Impact

- `@postel/core`: typed `PostelEventEmitter` + `LifecycleApi.on/off`; new `definePostelConfig`, `PostelEventMap`, `DeadLetterPayload`/`AttemptPayload`/`CircuitTransitionPayload`, `VerifierFailure` exports; `health()` probe + thresholds; `ObservabilityConfig.health`; multi-verifier aggregation in `inbound.ts`; optional `errors` on `PostelError`.
- `@postel/express`: descriptive `ConfigurationError` from the gate's raw-body reader.
- Tests: new/updated scenarios covered 1:1; the Noop malformed-envelope tests move from `SignatureInvalid` to `MalformedHeader`.
- Docs: getting-started gains the `definePostelConfig` rule; events and health pages reflect the typed `on` and the unhealthy conditions.
