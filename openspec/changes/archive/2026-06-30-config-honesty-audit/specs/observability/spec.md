## ADDED Requirements

### Requirement: Logger pass-through for runtime events [PORT-SPECIFIC]

The factory SHALL accept an optional `observability.logger`. When provided, the library SHALL forward its runtime delivery and circuit events to that logger as they occur, so the host has a real, non-silent observability hook before full OpenTelemetry / Prometheus instrumentation ships. The forwarded events are the same ones surfaced by `postel.on(event, handler)`: `attempt`, `circuit-open`, `circuit-close`, and `dead-letter`. Each forwarded entry carries the event name, a severity `level` (`attempt` → `debug`, `circuit-close` → `info`, `circuit-open` → `warn`, `dead-letter` → `error`), and the event payload.

`observability.logger` is the only `observability` sub-field in the current config surface. The `otel` and `metrics` keys are NOT part of the surface until the corresponding capabilities (*OpenTelemetry spans on every operation*, *Prometheus metrics*) ship; a config that has not built them does not advertise inert keys.

**Conformance**: PORT-SPECIFIC. The `logger` callable shape and the event→level mapping are reference-implementation ergonomics. What is durable is that the field, once accepted, demonstrably receives real events rather than being inert. Other ports expose a pass-through logger through their own idioms. The compliance suite does not exercise the logger.

#### Scenario: Logger receives a real delivery event

- **WHEN** a host constructs `Postel({ observability: { logger }, outbound: { storage } })`, registers an endpoint, sends a message, and the worker pool dispatches it
- **THEN** `logger` is invoked at least once with an `attempt` entry whose `data` names the dispatched message and endpoint
- **AND** the entry carries a severity `level`

#### Scenario: No logger is a no-op

- **WHEN** a host omits `observability` (or omits `observability.logger`)
- **THEN** dispatch proceeds normally and nothing is forwarded

## MODIFIED Requirements

### Requirement: Configurable retention with automatic pruning

The library SHALL support configurable retention windows per row type (messages, attempts) with automatic background pruning. Pruning MUST NOT block dispatch.

**Interim (TypeScript port):** background pruning has not shipped, so the `outbound.retention` config slot fails fast — configuring it throws `NotImplementedError` rather than silently retaining rows forever. See *Unimplemented config slots fail fast at construction* in `api-surface-typescript`.

#### Scenario: 30-day retention

- **WHEN** retention is set to 30 days for attempts and a row is older than 30 days
- **THEN** the pruning job removes the row asynchronously
