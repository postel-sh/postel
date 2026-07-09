## MODIFIED Requirements

### Requirement: Adapter mode for external job queues

The library SHALL provide an adapter interface so a host can hand each delivery to BullMQ or pg-boss instead of running the built-in worker, while the library retains ownership of signing, retry policy, and dead-letter semantics.

**Interim (TypeScript port):** `BullMQ(...)`, `PgBoss(...)`, and `External(...)` exist as typed `WorkerStrategy` factories, but no dispatch runtime has shipped for any of them. Configuring `outbound.workers` with anything other than `InProcess(...)` throws `NotImplementedError` at construction rather than silently running in-process or no-opping. See *Unimplemented config slots fail fast at construction* in `api-surface-typescript`. Their params stay `unknown` until a runtime lands — typing them is a breaking change to the factory signature, held out of the frozen typed surface for that reason.

#### Scenario: BullMQ adapter

- **WHEN** the host configures `postel` with the BullMQ adapter
- **THEN** outbox messages are pushed to BullMQ jobs that invoke the library's dispatch function
- **AND** retries / dead-letter still flow through library policy
