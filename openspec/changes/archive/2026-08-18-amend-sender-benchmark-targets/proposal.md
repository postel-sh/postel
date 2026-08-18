## Why

The sender spec claims a 4-worker/single-Postgres reference setup sustains ≥ 10,000 deliveries/sec and `send()` adds ≤ 5 ms p99, both marked "benchmarked, published per release" — but no benchmark suite existed anywhere in the repo (issue #143). We built the harness this change accompanies (`mise run bench`: testcontainers Postgres, 4 in-process workers, a local mock receiver) and ran it. Measured reality, on the documented reference machine, is roughly two orders of magnitude off both targets. Per `AGENTS.md` workflow rule 1, the spec is amended to the measured truth rather than shipping the aspirational numbers.

## What Changes

- **`Worker throughput target`**: floor lowered from ≥ 10,000 deliveries/sec to ≥ 150 deliveries/sec — a conservative floor under the ~360–400 deliveries/sec this harness measures on the reference machine (headroom for slower CI runners). The requirement now names the reference machine assumptions and points at the docs benchmarks page + `mise run bench` for reproduction, instead of asserting an unverified number.
- **`Send latency budget`**: ceiling raised from ≤ 5 ms p99 to ≤ 2000 ms p99 for a burst of 10,000 concurrent `send()` calls against a bounded (20-connection) pool — matching the ~1.4–1.5 s p99 this harness measures. 5 ms p99 was never achievable for a burst of 10,000 truly concurrent calls queuing through any realistically-sized connection pool; the old number described a different (unbatched, effectively unbounded-pool) scenario that was never built or tested.
- Neither change touches code paths, public API, or wire format — only the published numeric targets and the prose describing how they were derived.
- **BREAKING**: none. Both changes loosen the contract to match reality; no adopter-visible behavior changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sender`: MODIFIED "Send latency budget" — lower the latency ceiling to the measured value and name the load shape (10,000 concurrent calls, bounded pool) it was measured under.
- `sender`: MODIFIED "Worker throughput target" — lower the throughput floor to the measured value and name the reference machine + `mise run bench` as the reproduction path.

## Wire-format / DB-schema impact

None. No wire-format or DB-schema change.

## Impact

- `openspec/specs/sender/spec.md`: the two requirements above.
- `typescript/scripts/bench.mjs`: the harness that produced these numbers (introduced alongside this change, not by it).
- `typescript/packages/storage/pg/test/throughput-benchmark.test.ts`: new `POSTEL_PG_TESTCONTAINERS`-gated test asserting the new throughput floor against real Postgres, closing the `Worker throughput target` entry in `scripts/spec-drift-deferred.txt`.
- `scripts/spec-drift-deferred.txt`: remove the now-covered `Worker throughput target` line.
- `docs/content/docs/reference/benchmarks.mdx`: publishes the measured numbers and methodology (new page, not part of this spec change but landing in the same PR).
