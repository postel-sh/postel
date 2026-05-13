# retry-policy — delta spec

## MODIFIED Requirements

### Requirement: Endpoint auto-disable

The library SHALL support automatic endpoint disabling on sustained failure. The canonical default threshold is **100% failure rate over a rolling 24-hour window, with a minimum of 50 attempts in that window** (the minimum-attempt floor prevents endpoints with one or two failing attempts from being prematurely disabled). The threshold MUST be configurable per endpoint. When triggered, the endpoint state moves to `disabled` and a row is appended to `endpoint_state_transitions` with `reason: 'auto-disable'`.

#### Scenario: Default threshold triggers auto-disable

- **WHEN** an endpoint has at least 50 attempts in the past 24 hours and 100% of them failed
- **THEN** its state transitions to `disabled`
- **AND** `endpoint_state_transitions` records the transition with `actor: 'system'` and `reason: 'auto-disable'`

#### Scenario: Below minimum-attempt floor

- **WHEN** an endpoint has 10 attempts in the past 24 hours all failing
- **THEN** the endpoint remains `active` (the 50-attempt floor is not met)

## REMOVED Requirements

### Requirement: Replay safety contract

**Reason**: This requirement describes a host-facing choice between fresh and reused `webhook-id` on replay, which is a replay concern — not a retry concern. Misfiling it in `retry-policy` makes it hard for readers to discover and risks divergence with `replay-reconciliation`.
**Migration**: An equivalent requirement (`Replay safety contract`) is ADDED to `replay-reconciliation` in this same change.
