## Why

The previous OpenSpec change `2026-05-22-align-error-and-event-spec` added `NotImplementedError` → `NOT_IMPLEMENTED` to the `Structured error classes` requirement's canonical class ↔ code table, on the rationale that "every public failure mode SHALL throw a typed error class derived from `PostelError`." On reassessment that was a category error.

The other `PostelError` subclasses (`SignatureInvalid`, `TimestampTooOld`, `MalformedHeader`, `UnknownKeyId`, `RawBytesMismatchDetected`, `EndpointDisabled`, `SsrfBlocked`, …) all describe **webhook-protocol or wire-format failures** — runtime conditions an adopter handles in their request pipeline. `NotImplementedError` describes a **library-state failure** — "this method exists on the type but the runtime hasn't shipped in your installed version." Different category, different adopter response:

- Webhook errors → catch, log, return an appropriate HTTP code (typically 4xx).
- `NotImplementedError` → should bubble up as a programming error / version mismatch. The adopter needs to either upgrade the library or stop calling that method. It's a 5xx, not a 4xx — or really, it shouldn't reach production at all.

Putting `NotImplementedError` inside `PostelError` causes a real adopter foot-gun: the natural pattern `if (err instanceof PostelError) return 4xx; else throw` would incorrectly route library-state failures into the 4xx branch. The cross-port-symmetry argument is also weak — `NOT_IMPLEMENTED` is a transitional code that should never fire from production in any port post-v1.0, so embedding it in the cross-port `PostelErrorCode` union pollutes that vocabulary with TS-port-versioning state.

This change scopes the `Structured error classes` requirement to webhook-protocol / wire-format failures explicitly, removes the `NotImplementedError` row from the canonical class ↔ code table, and documents `NotImplementedError`'s deliberate exclusion from the hierarchy with rationale.

## What Changes

- Modify `Structured error classes`:
  - Tighten the scope statement from "every public failure mode" to "every public failure mode representing a webhook-protocol or wire-format outcome".
  - Remove the `NotImplementedError` → `NOT_IMPLEMENTED` row from the canonical class ↔ code table.
  - Replace the previous "NotImplementedError participates in the PostelError hierarchy" scenario with a new "Implementation-state errors are not PostelError" scenario asserting the opposite.
  - Add a paragraph documenting the rationale (adopter foot-gun, category distinction).

This is the inverse of the corresponding edits applied by `2026-05-22-align-error-and-event-spec`. The other half of that earlier change — making `timestamp` and `data` optional on the event shape requirement — stays intact and is unaffected.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api-surface-typescript`:
  - `Structured error classes` — narrows the requirement scope, removes one row from the canonical table, swaps one scenario for its inverse, adds rationale prose.

### Removed Capabilities

None.

## Wire-format / DB-schema impact

Wire-format: unchanged.
DB-schema: unchanged.

## Impact

- `openspec/specs/api-surface-typescript/spec.md` — one requirement body updated (applied via archive).
- `typescript/packages/edge/src/errors.ts` — `"NOT_IMPLEMENTED"` removed from the `PostelErrorCode` union.
- `typescript/packages/core/src/errors.ts` — `NotImplementedError` extends `Error` directly (not `PostelError`); keeps the stable `code: "NOT_IMPLEMENTED"` property for adopters who explicitly want to discriminate.
- `typescript/packages/core/test/postel-factory.test.ts` — assertion flipped to confirm `NotImplementedError` is NOT `instanceof PostelError`.
- `typescript/packages/core/README.md` — short note explaining the deliberate exclusion.
- No code is broken by the change; the externally visible behavior (a `NotImplementedError` is thrown with `code === "NOT_IMPLEMENTED"`) is unchanged. The only difference is `instanceof PostelError` now returns `false`, which restores correct adopter ergonomics for the `if (err instanceof PostelError) return 4xx` pattern.
