## 1. Spec

- [x] 1.1 `openspec/specs/sender/spec.md`: lower `Worker throughput target` floor to ≥ 100 deliveries/sec.

## 2. Test + docs

- [x] 2.1 `typescript/packages/storage/pg/test/throughput-benchmark.test.ts`: lower `FLOOR_PER_SEC` to 100.
- [x] 2.2 `docs/content/docs/reference/benchmarks.mdx`: update the published spec-floor number.

## 3. Verification

- [x] 3.1 `mise run check:all`.
- [x] 3.2 `POSTEL_PG_TESTCONTAINERS=1 pnpm --filter @postel/pg test`.
