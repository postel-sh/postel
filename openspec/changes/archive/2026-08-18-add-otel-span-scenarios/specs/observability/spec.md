## MODIFIED Requirements

### Requirement: OpenTelemetry spans on every operation

The library SHALL emit OpenTelemetry spans for `send`, `dispatch`, `attempt`, `retry`, and `replay` operations. Span attributes MUST follow the OTel semantic conventions for HTTP where applicable, and MUST carry the message, endpoint, and/or tenant identifiers relevant to that operation (e.g. a `send` span carries the message and tenant id; an `attempt` span additionally carries the endpoint id and the HTTP response status code). The OpenTelemetry API is an optional dependency: when no OTel provider is registered, or `@opentelemetry/api` is not installed at all, instrumented operations run with no spans created and no measurable overhead.

#### Scenario: Trace propagation

- **WHEN** the host runs in a traced HTTP handler that calls `send()`
- **THEN** the resulting `send` span is a child of the host's HTTP span and carries the same trace id

#### Scenario: Dispatch span carries message and tenant ids

- **WHEN** a worker reserves and dispatches a message belonging to tenant `t_1`
- **THEN** the resulting `dispatch` span carries that message's id and tenant id as attributes

#### Scenario: Attempt span carries endpoint id and HTTP status

- **WHEN** a dispatch attempt is delivered to an endpoint and the endpoint responds `200`
- **THEN** the resulting `attempt` span carries the endpoint id and an HTTP response status code attribute of `200`

#### Scenario: Retry span records the retry decision

- **WHEN** a delivery attempt fails and the retry policy schedules another attempt rather than dead-lettering the message
- **THEN** the resulting `retry` span carries the message and endpoint ids and completes without error

#### Scenario: Replay span carries the replayed message id

- **WHEN** a host calls `replay()` for a single `messageId`
- **THEN** the resulting `replay` span carries that message id as an attribute

#### Scenario: No provider registered is a no-op

- **WHEN** no OpenTelemetry tracer provider is registered, or `@opentelemetry/api` is not installed
- **THEN** `send`/`dispatch`/`attempt`/`retry`/`replay` operations complete normally with no spans created
