## MODIFIED Requirements

### Requirement: Health check endpoint

The library SHALL provide `postel.health()` returning `{ ok, outbox_depth, oldest_pending_age, worker_count }`. The endpoint MUST complete in **≤ 10 ms p99 on the reference benchmark hardware, excluding network round-trip and load-balancer probe overhead**. It is safe to wire to load-balancer health probes at high frequency (e.g., every second).

`health()` SHALL report `ok: false` on at least one real unhealthy condition, so it is a meaningful readiness probe rather than a constant `true`:

- **Storage probe failure** — when the outbox-depth probe (the storage read that backs `outbox_depth` / `oldest_pending_age`) throws, storage is unreachable and `health()` SHALL resolve with `ok: false` (it SHALL NOT reject). The depth/age fields MAY be absent in this case.
- **Outbox-depth threshold** — when a threshold is configured under `observability.health` and the current outbox depth or oldest-pending age exceeds it, `health()` SHALL report `ok: false` while still returning the observed depth/age.

The configurable thresholds under `observability.health` are `maxOutboxDepth` (an integer number of pending messages) and `maxOldestPendingAge` (a duration in the shared `number | "<integer><s|m|h|d>"` grammar). When neither is configured, depth alone never makes the instance unhealthy — only a storage probe failure does. An unhealthy result SHALL carry a human-readable `reason` naming the failing condition. A receiver-only instance (no `outbound` slot) has no outbox to probe and SHALL report `ok: true`.

#### Scenario: Healthy state

- **WHEN** the worker pool is healthy and outbox depth is 12
- **THEN** `health()` returns `{ ok: true, outbox_depth: 12, oldest_pending_age: <ms>, worker_count: 4 }`

#### Scenario: Storage probe failure reports unhealthy

- **WHEN** the outbox-depth probe throws (storage unreachable)
- **THEN** `health()` resolves with `ok: false` and a `reason` naming the storage probe failure
- **AND** `health()` does not reject

#### Scenario: Outbox-depth threshold breach reports unhealthy

- **WHEN** `observability.health.maxOutboxDepth` is 100 and the current outbox depth is 250
- **THEN** `health()` returns `ok: false` with `outbox_depth: 250` and a `reason` naming the threshold breach

#### Scenario: p99 latency under load

- **WHEN** `health()` is called 1,000 times per second concurrently
- **THEN** the p99 latency measured at the library boundary (excluding network) is ≤ 10 ms on the reference benchmark hardware
