## 1. Spec

- [x] 1.1 `Prometheus metrics`: add Conformance note + six scenarios (one existing, five new).
- [x] 1.2 `Structured JSON logs with trace correlation`: add Conformance note + one new scenario.
- [x] 1.3 `Admin HTTP handlers`: add `GET /health` to the route set + one new scenario.

## 2. Implementation

- [ ] 2.1 `core/src/sender/events.ts`: add `tenantId` to `AttemptPayload`, `latencyMs` to `AttemptPayload`, `tenantId` to `DeadLetterPayload`.
- [ ] 2.2 `core/src/sender/retry/orchestrator.ts`: pass `tenantId`/`latencyMs` through the `attempt` emit, `tenantId` through the `dead-letter` emit.
- [ ] 2.3 `core/src/observability/metrics.ts` (new): `MetricsRegistry` (in-memory counters/histograms keyed by label set) + `MetricsSnapshot` type; `recordSend`, `recordAttempt`, `recordDeadLetter`, `recordCircuitState`, `snapshot(storage)`.
- [ ] 2.4 `core/src/observability/tracing.ts`: `getActiveTraceId()` reading the already-cached, lazily-loaded OTel module's active span.
- [ ] 2.5 `core/src/outbound.ts`: construct the registry per `buildOutboundRuntime` call, wire `emitter.on(...)` for `attempt`/`dead-letter`/`circuit-open`/`circuit-close`, increment `webhook_send_total` in `api.send`, expose `metrics` on `OutboundRuntime`.
- [ ] 2.6 `core/src/postel.ts`: add `metrics(): Promise<MetricsSnapshot>` to `LifecycleApi`; attach `trace_id` (via `getActiveTraceId()`) to each forwarded `LogEvent`.
- [ ] 2.7 `admin/src/index.ts`: `AdminHost.health` (optional), `GET /health` route delegating to it.

## 3. Tests

- [ ] 3.1 `core/test/metrics.test.ts`: one test per new/existing Prometheus-metrics scenario, named after the scenario title verbatim.
- [ ] 3.2 `core/test/observability-logger.test.ts` (or existing logger test file): trace-id scenarios.
- [ ] 3.3 `admin/test/admin-router.test.ts`: `Health via admin router` scenario.

## 4. Docs

- [ ] 4.1 Dead-letter alerting recipe under `docs/content/docs/`.
- [ ] 4.2 Remove the `Prometheus metrics` and `Structured JSON logs with trace correlation` entries from `scripts/spec-drift-deferred.txt` once their scenarios have tests.

## 5. Verification

- [ ] 5.1 `mise run check:all` at the repo root.
- [ ] 5.2 `@postel/core` and `@postel/admin`'s test/lint/typecheck/build chains.
