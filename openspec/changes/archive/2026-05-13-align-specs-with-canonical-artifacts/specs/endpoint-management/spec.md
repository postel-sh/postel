# endpoint-management — delta spec

## MODIFIED Requirements

### Requirement: Endpoint state machine with audit trail

Endpoints SHALL transition between three states — `active`, `disabled`, and `circuit-open` — matching the canonical `endpoints.state` CHECK list in [`specs/db-schema/0001_init.sql`](../../../specs/db-schema/0001_init.sql). `re-enabled` is NOT a state; it is a transition *reason* recorded in `endpoint_state_transitions.reason` when a `disabled` endpoint moves back to `active`. Every state transition MUST be recorded in `endpoint_state_transitions` with the actor (`'system'` or a host-supplied user id), timestamp, the originating reason, and optional metadata.

#### Scenario: Auto-disable transition

- **WHEN** an endpoint hits the auto-disable threshold (see `retry-policy` for the canonical default)
- **THEN** its state transitions from `active` to `disabled`
- **AND** a row is appended to `endpoint_state_transitions` with `from_state: 'active'`, `to_state: 'disabled'`, `reason: 'auto-disable'`, `actor: 'system'`

#### Scenario: Circuit breaker opens

- **WHEN** an endpoint's circuit breaker (see `retry-policy`) trips
- **THEN** its state transitions from `active` to `circuit-open`
- **AND** the transition is recorded with `reason: 'circuit-open'`
- **AND** when the cooldown elapses and the breaker closes, a second transition records the `active` return with `reason: 'circuit-close'`

#### Scenario: Manual re-enable

- **WHEN** a disabled endpoint is manually re-enabled by an operator
- **THEN** its state transitions from `disabled` to `active`
- **AND** the transition is recorded with `reason: 're-enabled'` and the operator's actor id
