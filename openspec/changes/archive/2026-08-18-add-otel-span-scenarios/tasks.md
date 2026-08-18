## 1. Spec

- [x] 1.1 Add five scenarios to `observability`'s "OpenTelemetry spans on every operation" requirement (dispatch, attempt, retry, replay, no-provider no-op).

## 2. Implementation

- [ ] 2.1 `core/src/observability/tracing.ts`: lazy-loaded, memoized `@opentelemetry/api` import; `withSpan()` helper that no-ops when the API isn't installed; `traceDispatchOne()` wrapper for dispatch-pipeline stages.
- [ ] 2.2 Wire `postel.send` (outbound.ts), `postel.dispatch` (worker.ts), `postel.attempt` / `postel.retry` (outbound.ts, wrapping the HTTP and retry-orchestrator dispatchers), and `postel.replay` (outbound.ts) spans.
- [ ] 2.3 `core/package.json`: `@opentelemetry/api` as an optional peer dependency (`peerDependenciesMeta.optional`), plus dev dependency for tests.

## 3. Tests

- [ ] 3.1 `core/test/otel.test.ts`: one test per new/existing scenario, named after the scenario title verbatim.

## 4. Docs

- [ ] 4.1 Add a docs recipe page for wiring an OTel provider; remove the deferred entry in `scripts/spec-drift-deferred.txt`.

## 5. Verification

- [ ] 5.1 `mise run check:all` at the repo root.
- [ ] 5.2 `@postel/core`'s test/lint/typecheck/build chain.
