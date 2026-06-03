## ADDED Requirements

### Requirement: Endpoint creation provisions the initial signing secret [PORT-SPECIFIC]

When an endpoint is created through the public API, the library SHALL provision the endpoint's initial `primary` signing secret from the resolved signing strategy — the create-time `signing` option, else the outbound `signing` default, else HMAC (`v1`) — and store it in the same transaction as the endpoint row. For an Ed25519 (`v1a`) strategy the stored secret SHALL carry the public key, so the endpoint's key is retrievable via `outbound.keys.publicJwks()` without a prior rotation. The host MAY opt out with `provisionSecret: false` when it manages signing material externally, in which case create writes no secret.

**Conformance**: that a `v1a` endpoint's public key is retrievable via `publicJwks` without a prior rotation is CONTRACT — anchored by `key-management` *Current public signing keys are retrievable*. The mechanism — provisioning at create time, the `provisionSecret` opt-out, and the resolve-to-`v1` default — is PORT-SPECIFIC; a port MAY mint the initial secret through a different API shape as long as that outcome holds.

#### Scenario: v1a endpoint publishes its key without rotation

- **WHEN** an endpoint is created with an Ed25519 (`v1a`) signing strategy and `rotateSecret` is never called
- **THEN** `outbound.keys.publicJwks()` returns one key whose `kid` is the RFC 7638 thumbprint of that endpoint's stored public key

#### Scenario: Default HMAC secret on create

- **WHEN** an endpoint is created with no signing strategy configured
- **THEN** the endpoint holds exactly one `primary` `v1` (HMAC) secret
- **AND** that endpoint contributes no entry to `publicJwks`

#### Scenario: Opt out of provisioning

- **WHEN** an endpoint is created with `provisionSecret: false`
- **THEN** no signing secret is written for that endpoint
