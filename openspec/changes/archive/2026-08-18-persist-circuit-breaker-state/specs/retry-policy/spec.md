## ADDED Requirements

### Requirement: Circuit breaker state persists across restarts and processes [PORT-SPECIFIC]

Circuit-open state SHALL survive a worker process restart and SHALL be coherent across multiple worker processes sharing the same database: an endpoint that a circuit breaker opened MUST NOT remain stranded in `circuit-open` after the process that opened it is killed and restarted, and a sibling process reading the same endpoint MUST observe it as open. Recovery back to `active` happens automatically, via a half-open probe once the cooldown window elapses, with no manual operator intervention required.

**Conformance**: the outcome — circuit-open state survives restarts and is coherent across processes, with automatic half-open recovery — is CONTRACT. The reconciliation mechanism (e.g. reconstructing state from the endpoint's persisted `state` and its `endpoint_state_transitions` audit log, versus a dedicated DB-backed counters table) is PORT-SPECIFIC.

#### Scenario: Circuit-open endpoint recovers after worker restart

- **WHEN** a circuit opens for an endpoint, the worker process is killed and a new process starts in its place, and the cooldown window then elapses
- **THEN** the new process allows the next scheduled delivery to the endpoint through as a half-open probe, without any manual re-enable
- **AND** if the probe succeeds, the endpoint's state returns to `active`

#### Scenario: Circuit-open state visible to a second process immediately

- **WHEN** a circuit breaker opens for an endpoint in one worker process
- **THEN** a second worker process dispatching to the same endpoint observes it as `circuit-open` and does not attempt delivery, even though that second process's own local failure count never reached the threshold
