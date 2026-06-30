## ADDED Requirements

### Requirement: Unimplemented config slots fail fast at construction [PORT-SPECIFIC]

A config slot whose type exists on the public surface but whose runtime has not yet shipped SHALL reject configuration at construction time by throwing `NotImplementedError`, rather than accepting the value and silently never honoring it. The factory MUST NOT downgrade to a different behavior (e.g. plaintext storage when a KMS adapter was requested) without a signal. This generalizes the existing `workers` behavior — only the `in-process` strategy ships, and configuring `bullmq` / `pg-boss` / `external` throws — to every typed-but-unshipped slot.

The slots that fail fast in the current TypeScript port are:

- `outbound.kms` set to a built-in KMS adapter (`aws-kms`, `gcp-kms`, `vault`). `PlaintextKms` is accepted (it is the shipped storage behavior, explicitly opted into).
- `outbound.retention`.
- `outbound.ephemeralKeys`.
- `outbound.http.tls` and per-endpoint `http.tls` (the TLS-verification opt-out is not wired; TLS-on remains the runtime default).
- `outbound.http.dns` and per-endpoint `http.dns` (DNS-resolution pinning is not wired).

`NotImplementedError` is an implementation-state error (code `NOT_IMPLEMENTED`), not a `PostelError` — see *Structured error classes*. The capability of record for each slot (key-management, observability, sender) keeps its eventual contract; this requirement owns only the interim construction-time behavior.

**Conformance**: PORT-SPECIFIC. The OUTCOME — a configured-but-unimplemented feature never silently no-ops — is the cross-port intent, but the mechanism (throwing `NotImplementedError` at construction, the exact slot set, and which slots have shipped) is reference-implementation state. Other ports fail fast through their own idioms and on their own per-slot schedule. The compliance suite does not exercise unimplemented slots.

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

## MODIFIED Requirements

### Requirement: Outbound defaults are overridable per endpoint

The `outbound` config slot SHALL accept org-wide defaults for `signing`, `retryPolicy`, `circuitBreaker`, `autoDisable`, and `http`. Each `outbound.endpoints.create({...})` and `outbound.endpoints.update({...})` call SHALL accept the same option keys to override the org-wide default on a per-endpoint basis. The resolution order at dispatch time MUST be: per-endpoint value > org-wide default > library default. Storage adapter, KMS adapter, worker strategy, and retention policy are deployment-level and not overridable per endpoint.

Within `http`, the wired and overridable sub-fields are `requestTimeout`, `overallDeadline`, `ssrf`, and `userAgent`. The `http.tls` (TLS-verification opt-out) and `http.dns` (resolution pinning) sub-fields are not yet wired and fail fast at construction / endpoint creation — see *Unimplemented config slots fail fast at construction*.

#### Scenario: Per-endpoint retry override

- **WHEN** an org configures `outbound: { retryPolicy: ExponentialBackoff({...}) }` and a caller invokes `outbound.endpoints.create({ url, retryPolicy: LinearBackoff({...}) })`
- **THEN** the resulting endpoint uses the linear-backoff policy at dispatch time
- **AND** other endpoints with no per-endpoint override use the exponential default

#### Scenario: Per-endpoint request-timeout override

- **WHEN** an org configures `outbound: { http: { requestTimeout: '30s' } }` and a caller invokes `outbound.endpoints.create({ url, http: { requestTimeout: '5s' } })`
- **THEN** dispatch attempts to that endpoint use the 5-second per-request timeout
- **AND** other endpoints with no per-endpoint override use the 30-second default
