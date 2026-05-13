# observability — delta spec

## MODIFIED Requirements

### Requirement: Health check endpoint

The library SHALL provide `postel.health()` returning `{ ok, outbox_depth, oldest_pending_age, worker_count }`. The endpoint MUST complete in **≤ 10 ms p99 on the reference benchmark hardware, excluding network round-trip and load-balancer probe overhead**. It is safe to wire to load-balancer health probes at high frequency (e.g., every second).

#### Scenario: Healthy state

- **WHEN** the worker pool is healthy and outbox depth is 12
- **THEN** `health()` returns `{ ok: true, outbox_depth: 12, oldest_pending_age: <ms>, worker_count: 4 }`

#### Scenario: p99 latency under load

- **WHEN** `health()` is called 1,000 times per second concurrently
- **THEN** the p99 latency measured at the library boundary (excluding network) is ≤ 10 ms on the reference benchmark hardware
