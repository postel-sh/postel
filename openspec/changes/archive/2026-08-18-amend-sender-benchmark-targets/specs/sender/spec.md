## MODIFIED Requirements

### Requirement: Send latency budget

`send()` SHALL add ≤ 2000 ms p99 to the host transaction under a burst of 10,000 concurrent calls against a single Postgres node with a bounded (≤ 20-connection) pool. The single-insert design keeps this bounded; the number reflects queuing through a realistically-sized pool under a full-burst load, not an unbounded-pool ideal.

This is a benchmarked, published number (`mise run bench`; see the docs benchmarks page), re-measured per release rather than asserted.

#### Scenario: Latency under load

- **WHEN** 10,000 concurrent `send()` calls are issued against a healthy Postgres, through a pool of at most 20 connections
- **THEN** the p99 added latency is ≤ 2000 ms

### Requirement: Worker throughput target

A 4-worker configuration on a single Postgres node SHALL sustain ≥ 150 deliveries/sec to a healthy receiver. This is a benchmarked target, published per release via `mise run bench` and the docs benchmarks page, re-measured rather than asserted.

#### Scenario: Throughput benchmark

- **WHEN** the published benchmark suite (`mise run bench`) is run against the reference setup
- **THEN** sustained throughput is ≥ 150 deliveries/sec for the duration of the benchmark
