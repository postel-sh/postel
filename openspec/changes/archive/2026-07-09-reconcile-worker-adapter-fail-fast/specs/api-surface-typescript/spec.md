## MODIFIED Requirements

### Requirement: Unimplemented config slots fail fast at construction [PORT-SPECIFIC]

A config slot whose type exists on the public surface but whose runtime has not yet shipped SHALL reject configuration at construction time by throwing `NotImplementedError`, rather than accepting the value and silently never honoring it. The factory MUST NOT downgrade to a different behavior (e.g. plaintext storage when a KMS adapter was requested) without a signal. This generalizes the existing `workers` behavior — only the `in-process` strategy ships, and configuring `bullmq` / `pg-boss` / `external` throws — to every typed-but-unshipped slot.

The slots that fail fast in the current TypeScript port are:

- `outbound.workers` set to `BullMQ(...)`, `PgBoss(...)`, or `External(...)`. `InProcess(...)` is the only shipped worker runtime.
- `outbound.kms` set to a built-in KMS adapter (`aws-kms`, `gcp-kms`, `vault`). `PlaintextKms` is accepted (it is the shipped storage behavior, explicitly opted into).
- `outbound.retention`.
- `outbound.ephemeralKeys`.
- `outbound.http.tls` and per-endpoint `http.tls` (the TLS-verification opt-out is not wired; TLS-on remains the runtime default).
- `outbound.http.dns` and per-endpoint `http.dns` (DNS-resolution pinning is not wired).

`NotImplementedError` is an implementation-state error (code `NOT_IMPLEMENTED`), not a `PostelError` — see *Structured error classes*. The capability of record for each slot (key-management, observability, sender) keeps its eventual contract; this requirement owns only the interim construction-time behavior.

**Conformance**: PORT-SPECIFIC. The OUTCOME — a configured-but-unimplemented feature never silently no-ops — is the cross-port intent, but the mechanism (throwing `NotImplementedError` at construction, the exact slot set, and which slots have shipped) is reference-implementation state. Other ports fail fast through their own idioms and on their own per-slot schedule. The compliance suite does not exercise unimplemented slots.

#### Scenario: Non-in-process worker strategies fail fast

- **WHEN** a caller constructs `Postel({ outbound: { storage, workers: BullMQ(queue) } })`, `PgBoss(boss)`, or `External(adapter)`
- **THEN** construction throws `NotImplementedError` for all three
- **AND** `err.code === 'NOT_IMPLEMENTED'`
- **AND** no queue/adapter code path is silently exercised in-process instead

#### Scenario: Built-in KMS adapter fails fast

- **WHEN** a caller constructs `Postel({ outbound: { storage, kms: AwsKms({ keyId }) } })` (or `GcpKms` / `Vault`)
- **THEN** construction throws `NotImplementedError`
- **AND** `err.code === 'NOT_IMPLEMENTED'`
- **AND** no endpoint secret is ever written in plaintext under the assumption that KMS was active

#### Scenario: PlaintextKms and a fully-wired config construct without throwing

- **WHEN** a caller constructs `Postel({ outbound: { storage, kms: PlaintextKms() } })`, or omits `kms` entirely
- **THEN** construction succeeds
- **AND** the same holds for a config that sets only wired slots (`signing`, `retryPolicy`, `workers: InProcess(...)`, `circuitBreaker`, `autoDisable`, `replay`, `http.{requestTimeout,overallDeadline,ssrf,userAgent,fetch}`)

#### Scenario: Retention and ephemeral-keys slots fail fast

- **WHEN** a caller constructs `Postel({ outbound: { storage, retention: { attempts: '30d' } } })`, or sets `ephemeralKeys: { rotateEvery: '12h' }`
- **THEN** construction throws `NotImplementedError`

#### Scenario: Unwired HTTP security knobs fail fast

- **WHEN** a caller sets `outbound.http.tls` (e.g. `{ verify: false }`) or `outbound.http.dns` (e.g. `{ pinResolution: true }`), at the org level or as a per-endpoint `http` override on `endpoints.create` / `endpoints.update`
- **THEN** the call throws `NotImplementedError`
