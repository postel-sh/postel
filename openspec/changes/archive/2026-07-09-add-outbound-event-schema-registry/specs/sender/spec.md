## ADDED Requirements

### Requirement: Per-type event schema validation on send

The outbound side MAY declare an event registry — a map from event `type` string to a schema — that mirrors the receiver's per-source `schema`. When `send()` is called with a `type` present in the registry, the library SHALL validate `event.data` against the registered schema BEFORE the message is persisted to the outbox. On mismatch, `send()` SHALL throw `EventValidation` and MUST NOT write an outbox row for the rejected message. When `type` is absent from the registry, `send()` behaves exactly as it does today: no validation is attempted and the message is persisted unchanged.

**Conformance**: the validation OUTCOME (validate before persisting; throw on mismatch; no partial/rejected outbox row) is CONTRACT. The registry's schema mechanism is a TypeScript-port detail — see `api-surface-typescript`.

#### Scenario: Registered type with valid data persists normally

- **WHEN** `send({ type: "user.created", data })` is called and `"user.created"` is registered with a schema that `data` satisfies
- **THEN** the outbox row is written exactly as it would be with no registry configured

#### Scenario: Registered type with invalid data is rejected before persistence

- **WHEN** `send({ type: "user.created", data })` is called and `data` does not satisfy the registered schema for `"user.created"`
- **THEN** `send()` throws `EventValidation` and does not persist an outbox row for that message

#### Scenario: Unregistered type is fully permissive

- **WHEN** `send({ type: "some.unregistered.type", data })` is called and no schema is registered for that `type`
- **THEN** no validation is attempted and the message is persisted unchanged, identical to today's behavior
