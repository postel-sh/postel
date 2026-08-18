## 1. Spec

- [x] 1.1 `openspec/specs/sender/spec.md`: amend `Send latency budget` ceiling to ≤ 2000 ms p99 (10,000 concurrent sends, ≤ 20-connection pool) — archived via this change.
- [x] 1.2 `openspec/specs/sender/spec.md`: amend `Worker throughput target` floor to ≥ 150 deliveries/sec — archived via this change.

## 2. Benchmark harness

- [x] 2.1 `typescript/scripts/bench.mjs`: testcontainers Postgres + 4 in-process workers + mock receiver; measures send() latency percentiles and sustained deliveries/sec.
- [x] 2.2 `mise.toml`: `mise run bench` task.

## 3. Test coverage

- [x] 3.1 `typescript/packages/storage/pg/test/throughput-benchmark.test.ts`: `POSTEL_PG_TESTCONTAINERS`-gated test asserting the new ≥ 150 deliveries/sec floor against real Postgres, titled to cover the `Throughput benchmark` scenario.
- [x] 3.2 `scripts/spec-drift-deferred.txt`: remove the `Worker throughput target` line now that it's covered.

## 4. Docs

- [x] 4.1 `docs/content/docs/reference/benchmarks.mdx`: publish the measured numbers, methodology, and machine assumptions.

## 5. Verification

- [x] 5.1 `mise run check:all` at the repo root.
- [x] 5.2 `@postel/pg` and `@postel/core` test chains, including the `POSTEL_PG_TESTCONTAINERS=1` tier.
