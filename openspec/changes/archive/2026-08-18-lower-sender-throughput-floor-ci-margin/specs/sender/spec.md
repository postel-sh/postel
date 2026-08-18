## MODIFIED Requirements

### Requirement: Worker throughput target

A 4-worker configuration on a single Postgres node SHALL sustain ≥ 100 deliveries/sec to a healthy receiver. This is a benchmarked target, published per release via `mise run bench` and the docs benchmarks page, re-measured rather than asserted.

#### Scenario: Throughput benchmark

- **WHEN** the published benchmark suite (`mise run bench`) is run against the reference setup
- **THEN** sustained throughput is ≥ 100 deliveries/sec for the duration of the benchmark
