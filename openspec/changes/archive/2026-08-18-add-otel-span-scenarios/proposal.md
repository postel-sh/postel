## Why

Issue #141: the observability capability's OpenTelemetry requirement has zero code (`grep -rn opentelemetry typescript/packages` — nothing), and it is deferred in `scripts/spec-drift-deferred.txt`. The requirement's prose already commits to spans for five distinct operations (`send`, `dispatch`, `attempt`, `retry`, `replay`) carrying message/endpoint/tenant attributes, but the spec has only one thin scenario (`Trace propagation`) — not enough to drive or verify an implementation of the other four operations or the attribute contract. Per `AGENTS.md` rule 3 ("tests are scenarios, 1:1"), implementing those operations without scenarios to test against would mean writing tests that don't trace back to anything in the spec.

## What Changes

- Add five scenarios to the existing "OpenTelemetry spans on every operation" requirement, covering: the `dispatch`, `attempt`, `retry`, and `replay` spans (each with their expected identifying attributes), plus a "no provider registered" no-op scenario capturing the zero-overhead behavior implied by "core stays zero-dependency when unused."
- No new requirement, no requirement removed — this only rounds out scenario coverage for a requirement that already existed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `observability`: `OpenTelemetry spans on every operation` gains five scenarios (dispatch/attempt/retry/replay attribute coverage, no-op-without-provider). Still CONTRACT — no conformance change.

## Wire-format / DB-schema impact

None.

## Impact

- `@postel/core`: `src/observability/tracing.ts` (new), `src/outbound.ts`, `src/sender/worker/worker.ts` — implementation follows in the same PR as this change's archive.
- `docs/`: a new recipe page documents the optional-peer-dependency setup.
