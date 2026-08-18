## ADDED Requirements

### Requirement: Bounded single-pass drain for serverless invocation

The outbound API SHALL provide a bounded, single-pass drain operation, `drain({ maxMessages, deadline })`, that reserves and dispatches at most `maxMessages` outbox messages, or runs until `deadline` elapses, whichever happens first, then returns. `drain()` MUST NOT start a persistent worker loop — it performs a fixed number of reservation/dispatch cycles bounded by `maxMessages` and `deadline`, then resolves.

`drain()` SHALL reserve messages through the same mechanism as `Workers drain the outbox safely under concurrency` (`FOR UPDATE SKIP LOCKED` on Postgres, `BEGIN IMMEDIATE` on SQLite), so it is safe to call `drain()` concurrently with a running `postel.start()` worker pool, or with multiple concurrent `drain()` calls: each outbox row is reserved and dispatched at most once across all callers.

*How* a host triggers `drain()` on a recurring basis — a cron schedule, an HTTP handler invoked by a platform scheduler, a queue consumer, or a manual call — is entirely host-determined. Postel does not provide or require a scheduler; no requirement here governs the triggering mechanism.

#### Scenario: Stops at maxMessages

- **WHEN** the outbox has 50 pending messages and a caller runs `drain({ maxMessages: 10, deadline: '30s' })`
- **THEN** at most 10 messages are reserved and dispatched
- **AND** `drain()` resolves without waiting for the remaining 40 messages or spawning a persistent loop

#### Scenario: Stops at deadline

- **WHEN** the outbox has pending messages remaining and the configured `deadline` elapses before `maxMessages` is reached
- **THEN** `drain()` stops reserving further messages and resolves
- **AND** the result reports that the deadline, not `maxMessages`, ended the run

#### Scenario: Safe alongside a running worker pool

- **WHEN** a `postel.start()` worker pool is running and a concurrent `drain()` call reserves from the same outbox
- **THEN** no message is dispatched more than once between the pool and the `drain()` call
- **AND** each pending message is eventually reserved by exactly one of them
