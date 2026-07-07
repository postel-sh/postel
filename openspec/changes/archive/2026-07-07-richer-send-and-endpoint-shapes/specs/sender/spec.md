## RENAMED Requirements

- FROM: `### Requirement: Send is non-blocking and returns a MessageId`
- TO: `### Requirement: Send is non-blocking and returns a SendResult`

### Requirement: Send is non-blocking and returns a SendResult

The library SHALL expose a public sender entry point of the form `postel.send({ type, data, channels?, idempotencyKey?, version? })` that synchronously persists the event into the outbox and returns a `SendResult` carrying the message identity: `id` (the `MessageId`) and `reused` (a boolean). `reused` SHALL be `true` only when a caller-supplied `idempotencyKey` matched an existing outbox row (see *Idempotent send by client-supplied key*); a send without an `idempotencyKey`, or one whose key matched no existing row, SHALL report `reused: false`. The call MUST NOT block on network I/O to the receiver.

#### Scenario: Successful enqueue

- **WHEN** the host calls `postel.send({ type: 'order.created', data: {...} })`
- **THEN** the library inserts the event into the outbox in a single SQL statement and returns a `SendResult` whose `id` is the new `MessageId` and whose `reused` is `false`
- **AND** no HTTP request to any receiver is made on this code path

## MODIFIED Requirements

### Requirement: Idempotent send by client-supplied key

When `idempotencyKey` is provided, a duplicate `send()` SHALL return the existing message's `id` with `reused: true`, without inserting a new row or scheduling a duplicate delivery. The first send with a given key reports `reused: false` — the flag is how a caller distinguishes "accepted" from "deduplicated".

#### Scenario: Repeat send with same key

- **WHEN** `postel.send({...}, { idempotencyKey: 'abc' })` is called twice with identical arguments
- **THEN** both calls return the same `id`
- **AND** the first call reports `reused: false` and the second reports `reused: true`
- **AND** the outbox contains exactly one row for that key
