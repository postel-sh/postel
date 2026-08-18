## MODIFIED Requirements

### Requirement: Framework adapters offer optional dedup-acknowledgement

A framework gate MAY be configured to acknowledge duplicates using the source's configured dedup adapter. When enabled, the gate SHALL verify the request FIRST, then look up `dedup(messageId)` keyed on the `webhook-id`; if the id has been recorded within the TTL, the gate SHALL respond `2xx` with the header `X-Postel-Dedup-Result: duplicate` and SHALL NOT invoke the adopter's handler. On first receipt the gate MUST NOT set that header, MUST record the id, and MUST invoke the handler. When no dedup is configured the gate SHALL be a pass-through — every verified request reaches the handler. Dedup SHALL run only AFTER successful verification, so an unauthenticated `webhook-id` can never short-circuit handling.

If the adopter's handler throws after the gate recorded a fresh (non-duplicate) id, the gate SHALL attempt to release that record via the dedup adapter's `release` capability, when the configured adapter provides one, BEFORE the handler's error propagates. This SHALL NOT run for a request the gate already answered as a duplicate — only for the request that just wrote the record. A release failure MUST NOT suppress or replace the handler's original error. When the configured dedup adapter does not implement `release`, the gate skips this step and the prior (pre-fix) behavior applies for that adapter: the id stays recorded for its TTL.

**Conformance**: the `2xx` + `X-Postel-Dedup-Result: duplicate` signal, the verify-before-dedup ordering, and "a handler failure on a release-capable adapter must not permanently burn the id" are CONTRACT. The dedup storage backend and the release mechanism (delete, tombstone, TTL rewrite, …) remain PORT-SPECIFIC via the dedup adapter.

#### Scenario: First receipt invokes the handler

- **WHEN** a gate with dedup enabled sees a fresh `webhook-id`
- **THEN** the adopter's handler runs
- **AND** no `X-Postel-Dedup-Result` header is set

#### Scenario: Duplicate receipt is acknowledged without invoking the handler

- **WHEN** the same `webhook-id` arrives a second time within the TTL on a dedup-enabled gate
- **THEN** the gate responds `2xx` with `X-Postel-Dedup-Result: duplicate`
- **AND** the adopter's handler does not run

#### Scenario: Dedup disabled is a pass-through

- **WHEN** no dedup adapter is configured on the gate
- **THEN** every verified request reaches the handler regardless of `webhook-id` repetition

#### Scenario: Dedup runs only after verification

- **WHEN** a request that fails verification arrives on a dedup-enabled gate
- **THEN** the gate rejects it with the mapped 4xx status
- **AND** the dedup adapter is never consulted for that request

#### Scenario: Handler failure releases the dedup record

- **WHEN** a gate with dedup enabled records a fresh `webhook-id` and the adopter's handler then throws
- **THEN** the gate releases the just-written dedup record before the error propagates
- **AND** a subsequent retry of the same `webhook-id` is treated as unseen: the handler runs again

#### Scenario: Release failure does not mask the handler's error

- **WHEN** the adopter's handler throws and the dedup adapter's `release` call itself fails
- **THEN** the gate still propagates the handler's original error
- **AND** the id remains recorded for its TTL

#### Scenario: Handler failure is a no-op for an already-answered duplicate

- **WHEN** a duplicate `webhook-id` was acknowledged with `2xx duplicate` without running the handler
- **THEN** that request never calls `release` — release only follows a request that itself recorded the id
