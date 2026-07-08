# Language impact

| Port | Status | Notes |
|---|---|---|
| typescript-sender | modified | Typed `postel.on/off` over `PostelEventMap`; `health()` gains real unhealthy conditions and `observability.health` thresholds; `definePostelConfig` helper. |
| typescript-receiver | modified | Inbound multi-verifier loop aggregates every verifier failure on the thrown error (`errors`) and surfaces a unanimous `MalformedHeader` as itself; the Express gate throws a descriptive `ConfigurationError` when the raw body was already consumed. |
| go-sender (planned) | unchanged | Typed event map, `definePostelConfig`, and the `errors` array shape are TypeScript type-system mechanisms; other ports expose events, config typing, and aggregated failures through their own idioms. |
| go-receiver (planned) | unchanged | Aggregating verifier failures for diagnosis is the durable OUTCOME; the `errors`/`AggregateError` shape and the unanimous-`MalformedHeader` refinement are TS-port diagnostics (both HTTP outcomes stay 400). The consumed-raw-body guard addresses an Express/Node body-parser hazard specifically. |
| python-receiver (planned) | unchanged | Same as go-receiver. |
| python-sender (planned) | unchanged | Same as go-sender. |
| rust-sender (planned) | unchanged | Same as go-sender. |
| rust-receiver (planned) | unchanged | Same as go-receiver. |
| wire-format | unchanged | No item crosses the wire; the #93 unanimous-`MalformedHeader` refinement maps to the same HTTP 400. |
| db-schema | unchanged | |

## Lockstep / lag

No lockstep required. Every requirement added here is `[PORT-SPECIFIC]` except the health-check OUTCOME (`health()` reports unhealthy on a genuine failure), whose *mechanism* (which conditions, which thresholds) remains reference-implementation state. Planned ports MAY lag and expose these ergonomics through their own idioms when they ship.
