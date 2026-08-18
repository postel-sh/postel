## ADDED Requirements

### Requirement: Message finalized as dead-lettered on exhaustion

Once every endpoint's outcome for a message is final (no endpoint has retryable work remaining), the message's outbox `status` SHALL be set to `dead-lettered` — not `dispatched` — when at least one endpoint reached `dead-letter` and no endpoint delivered successfully. If at least one endpoint delivered successfully, the message's outbox `status` SHALL remain `dispatched` even when a sibling endpoint dead-lettered, since the message was, on the whole, delivered.

#### Scenario: Single endpoint exhausts retries

- **WHEN** a message's only endpoint exhausts its retry schedule and the attempt is marked `dead-letter`
- **THEN** the message's outbox `status` becomes `dead-lettered`

#### Scenario: Fanout with a surviving success stays dispatched

- **WHEN** a message fans out to two endpoints, one of which dead-letters while the other delivers successfully
- **THEN** the message's outbox `status` is `dispatched`, not `dead-lettered`
