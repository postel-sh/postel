## Why

Issue #142: the observability capability's last two pillars — Prometheus metrics and trace-correlated structured logs — have zero code (`grep -rn 'prom-client|prometheus|traceId' typescript/packages/core/src typescript/packages/admin/src` finds nothing), and both requirements are wholesale-deferred in `scripts/spec-drift-deferred.txt`. Both requirements commit to an outcome (`webhook_*` metric names/labels; a `trace_id` field on log lines) but neither says how a dependency-free TypeScript port delivers it. Per `AGENTS.md` rule 1, that mechanism gap gets resolved via an OpenSpec change before implementation, not decided silently in the PR.

Retention pruning (the sixth requirement in this capability) stays out of scope — it already has its own `[interim]` fail-fast note and is not touched here.

## What Changes

- `Prometheus metrics`: add a **Conformance** note splitting the metric names/labels/semantics (CONTRACT) from the exposition mechanism (PORT-SPECIFIC — this port exposes a pull-based `postel.metrics()` snapshot rather than bundling `prom-client`). Add scenarios for the four event-driven metrics (`webhook_send_total`, `webhook_attempt_duration_seconds`, `webhook_attempt_success_ratio`, `webhook_dead_letter_total`, `webhook_endpoint_circuit_state`) and a no-outbound no-op scenario. The existing `Outbox depth metric` scenario is unchanged.
- `Structured JSON logs with trace correlation`: add a **Conformance** note — the mechanism is the existing `observability.logger` pass-through (a `trace_id` field on the forwarded `LogEvent`, CONTRACT: present and correlated whenever a trace is active; PORT-SPECIFIC: carried on the same pass-through as the `Logger pass-through for runtime events` requirement rather than a library-owned JSON writer). Add a "no active trace" no-op scenario.
- `Admin HTTP handlers`: extend the route set with `GET /admin/health`, wrapping the existing `postel.health()` (already returns `outbox_depth` / `oldest_pending_age` / `worker_count`) so ops tooling gets the queue-depth / oldest-pending gauges over HTTP through the same authorized router. Add one scenario.

No requirement is removed. No wire-format or DB-schema impact.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `observability`: `Prometheus metrics` and `Structured JSON logs with trace correlation` each gain a Conformance note (mixed CONTRACT/PORT-SPECIFIC) and new scenarios; `Admin HTTP handlers` gains one route and one scenario.

## Wire-format / DB-schema impact

None.

## Impact

- `@postel/core`: `src/observability/metrics.ts` (new), `src/observability/tracing.ts` (active-trace-id accessor), `src/sender/events.ts` (add `tenantId` to `AttemptPayload`/`DeadLetterPayload`), `src/sender/retry/orchestrator.ts`, `src/outbound.ts`, `src/postel.ts`.
- `@postel/admin`: `src/index.ts` (`GET /admin/health` route, `AdminHost.health`).
- `docs/`: a dead-letter alerting recipe; remove the two wholesale-deferred entries in `scripts/spec-drift-deferred.txt` once their scenarios have tests.
