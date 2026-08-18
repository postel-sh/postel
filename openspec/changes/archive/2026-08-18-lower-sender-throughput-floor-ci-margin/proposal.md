## Why

The `Worker throughput target` floor was set to ≥ 150 deliveries/sec in `amend-sender-benchmark-targets`, measured with ~360–400 deliveries/sec headroom on the author's machine. The first CI run of the covering test (`throughput-benchmark.test.ts`) on GitHub Actions' shared runner measured **143.6 deliveries/sec** — below the 150 floor, failing the contractual assertion on a slower, real-world CI runner. The floor needs more margin below observed reality, not just below one machine's reality.

## What Changes

- **`Worker throughput target`**: floor lowered from ≥ 150 to ≥ 100 deliveries/sec — comfortably under the 143.6/sec observed on GitHub's shared TS runner, while still far above zero and meaningfully validating the reference setup drains its outbox.
- `typescript/packages/storage/pg/test/throughput-benchmark.test.ts` and `docs/content/docs/reference/benchmarks.mdx` updated to match.
- **BREAKING**: none.

## Capabilities

### Modified Capabilities

- `sender`: MODIFIED "Worker throughput target" — lower the floor to ≥ 100 deliveries/sec for CI-runner headroom.

## Wire-format / DB-schema impact

None.

## Impact

- `openspec/specs/sender/spec.md`.
- `typescript/packages/storage/pg/test/throughput-benchmark.test.ts`.
- `docs/content/docs/reference/benchmarks.mdx`.
