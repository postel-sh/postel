# api-surface-typescript Specification

## Purpose

The TypeScript-port public API surface — the `Postel` factory, typed event-shape generics, structured `PostelError` class hierarchy, Effect-TS adapter, and the convention that every write accepts an optional transaction handle (host-transaction passthrough). One port among the planned polyglot set per [ADR 0005](../../../decisions/0005-polyglot-staged-rollout.md); future language ports follow the same compliance contract under their own `api-surface-<lang>` capabilities.
## Requirements
### Requirement: Postel factory returns the library instance

The TypeScript port SHALL expose `Postel({ observability?, outbound?, inbound? })` returning a fully-typed instance whose shape is conditional on which slots are configured:

- **Lifecycle methods are always present**: `postel.start()`, `postel.stop()`, `postel.health()`.
- **`postel.outbound`** is present iff the `outbound` config slot is provided. It carries `send`, `endpoints.{create,update,delete,list,get,disable,rotateSecret}`, `keys.{generateSymmetric,generateAsymmetric}`, `tenants.{setRateLimit,delete,get,list}`, `replay`, `reconcile`, and the read/introspection surface `messages.{get,attempts,list}`.
- **`postel.inbound`** is present iff the `inbound` config slot is provided. For each configured source key `K`, `postel.inbound[K]` exposes `verify` and (if a dedup adapter is configured for that source) `dedup`.

The factory identifier is the PascalCase `Postel` — a callable function, not a class; adopters do not use `new`. This capability spec describes the TypeScript port — one of several first-class language ports per [ADR 0005 — Polyglot staged rollout](../../../decisions/0005-polyglot-staged-rollout.md). Other ports' API surfaces are defined under their own `api-surface-<lang>` capabilities and conform to the same compliance contract.

The `messages.{get,attempts,list}` read surface is the TypeScript projection of the `message-introspection` capability; its read OUTCOME (a message and its attempt history are retrievable) is the cross-port CONTRACT, while these method names are the port mechanism. The `tenants.{get,list}` read surface is the TypeScript projection of the `multi-tenancy` capability's tenant-read requirements; its read OUTCOME (a tenant is retrievable by id, and tenants are listable in a bounded, paginated order) is the cross-port CONTRACT, while these method names are the port mechanism. Every list-returning read on the outbound surface — `endpoints.list`, `messages.list`, `tenants.list`, and `reconcile` — accepts the shared `CursorOptions` (`{ limit?, cursor? }`) and resolves to the shared `Page<T>` (`{ items, nextCursor }`); the bounded-with-cursor-continuation OUTCOME is CONTRACT per [ADR 0015](../../../decisions/0015-pagination-envelope.md), while the `Page<T>` / `CursorOptions` type names and cursor encoding are the port mechanism.

#### Scenario: Type inference for the outbound surface

- **WHEN** a TypeScript caller writes `const postel = Postel({ outbound: { storage: DrizzleStorage(db) } })`
- **THEN** `postel.outbound.send(...)` is typed without explicit type parameters
- **AND** `postel.inbound` does not exist on the instance type

#### Scenario: Type inference for the inbound surface

- **WHEN** a TypeScript caller writes `const postel = Postel({ inbound: { github: { verify: Secret(s) } } })`
- **THEN** `postel.inbound.github.verify(body, headers)` is typed with the source key narrowed to `'github'`
- **AND** `postel.outbound` does not exist on the instance type

#### Scenario: Outbound read surface is present

- **WHEN** a TypeScript caller configures `outbound` and calls `postel.outbound.messages.get(id)`
- **THEN** the call is well-typed and returns the message (or an absent result)
- **AND** `postel.outbound.messages.attempts(id)` and `postel.outbound.messages.list(...)` are present on the instance type, with `messages.list(...)` resolving to a `{ items, nextCursor }`-shaped page

#### Scenario: Outbound tenant read surface is present

- **WHEN** a TypeScript caller configures `outbound` and calls `postel.outbound.tenants.get(id)`
- **THEN** the call is well-typed and returns the tenant (or an absent result)
- **AND** `postel.outbound.tenants.list(...)` is present on the instance type and resolves to a `{ items, nextCursor }`-shaped page

### Requirement: Public function signatures match Standard Webhooks event shape

The TS API SHALL accept and produce events shaped as `{ type, timestamp?, data?, channels?, version? }`. Only `type` is required; `timestamp`, `data`, `channels`, and `version` are optional. Standard Webhooks carries the canonical message timestamp on the `webhook-timestamp` HTTP header — an event body MAY include a `timestamp` field as a host-side convention but is not required to. `data` is optional for events with no payload (e.g., a `user.deleted` event where the receiver identifies the user from headers or message id alone). Type definitions MUST flow through to consumers without `any`.

#### Scenario: Strongly-typed event

- **WHEN** a consumer calls `postel.outbound.send<OrderCreated>({ type: 'order.created', data: {...} })`
- **THEN** TypeScript infers the `data` shape from the `OrderCreated` generic

#### Scenario: Event with only the required `type` field

- **WHEN** a consumer calls `postel.outbound.send({ type: 'user.deleted' })` with no `data`, `timestamp`, `channels`, or `version`
- **THEN** the call is well-typed and accepted; no field beyond `type` is mandated by the library's public types

### Requirement: Structured error classes

Every public failure mode representing a **webhook-protocol or wire-format outcome** SHALL throw a typed error class derived from `PostelError`. Each `PostelError` subclass MUST have:

- A **PascalCase class name** (TypeScript-idiomatic).
- A stable **`code` property** in SCREAMING_SNAKE_CASE that matches the corresponding error code documented in `receiver` (so the codes are consumable from contexts that don't have access to the class hierarchy — e.g., admin handler JSON payloads, cross-port port API audits, log correlation).
- Discoverable via `instanceof` AND via `err.code === 'X'` checks.

The canonical class ↔ code mapping is:

| Class | `.code` |
|---|---|
| `SignatureInvalid` | `SIGNATURE_INVALID` |
| `TimestampTooOld` | `TIMESTAMP_TOO_OLD` |
| `MalformedHeader` | `MALFORMED_HEADER` |
| `UnknownKeyId` | `UNKNOWN_KEY_ID` |
| `RawBytesMismatchDetected` | `RAW_BYTES_MISMATCH_DETECTED` |
| `EventValidation` | `EVENT_VALIDATION` |
| `EndpointDisabled` | `ENDPOINT_DISABLED` |
| `EndpointNotFound` | `ENDPOINT_NOT_FOUND` |
| `IdempotencyKeyConflict` | `IDEMPOTENCY_KEY_CONFLICT` |
| `MigrationRequired` | `MIGRATION_REQUIRED` |
| `EndpointValidation` | `ENDPOINT_VALIDATION` |
| `SsrfBlocked` | `SSRF_BLOCKED` |

`EventValidation` additionally carries the failing schema's `issues` (a `ReadonlyArray<StandardSchemaV1.Issue>`).

Adding a new error class MUST add both names atomically. The `receiver` capability's error-code list and this table are synchronized — drift between the two is treated as a bug.

**Implementation-state errors are intentionally outside the `PostelError` hierarchy.** Errors that describe library state rather than webhook semantics — e.g., `NotImplementedError`, thrown when a port version exposes a typed method whose runtime has not yet shipped — describe a *different category* of failure than webhook-protocol outcomes. Adopters who write the natural pattern `if (err instanceof PostelError) return 4xx` are translating webhook-protocol failures into HTTP responses; that pattern MUST NOT accidentally catch implementation-state errors and convert them into HTTP 4xx, because library-state failures are programming/version errors that should bubble as 5xx (or fail-fast in development). Implementation-state errors SHALL therefore extend the platform `Error` class directly and SHALL carry a stable `code` property (e.g., `code: 'NOT_IMPLEMENTED'`) for adopters who explicitly want to discriminate them, but they SHALL NOT extend `PostelError` and their codes SHALL NOT appear in the `PostelErrorCode` union.

**Configuration errors are likewise outside the `PostelError` hierarchy.** A mistake in developer-supplied configuration or library usage — an inbound source configured with no verifiers, `dedup()` invoked without a ttl, an unparsable ttl value, an empty secret array, a `secretOrKeyset` that is not a string / string array / Keyset, a receiver-side secret carrying the ed25519-private prefix, `createKeyset` in a runtime with no `fetch`, or `signFixture` with an unsupported secret kind — is an integrator bug, not a wire-format outcome, and SHALL throw `ConfigurationError`. `ConfigurationError` SHALL extend the platform `Error` class directly, SHALL carry `name = 'ConfigurationError'` and a stable `code = 'CONFIGURATION_ERROR'`, SHALL NOT extend `PostelError`, and its code SHALL NOT appear in the `PostelErrorCode` union — so the `if (err instanceof PostelError) return 4xx` pattern and the `PostelErrorCode`-keyed status maps in `@postel/http` and `@postel/admin` never translate a configuration bug into a client error; it bubbles as a 5xx (or fail-fast in development). Wire-format failures — missing or unparsable signing headers, malformed signature tuples, malformed event envelopes, malformed JWKS documents, and failed runtime JWKS fetches — remain `MalformedHeader`.

#### Scenario: instanceof discrimination

- **WHEN** a consumer wraps `verify(...)` in try/catch and inspects the error
- **THEN** `err instanceof SignatureInvalid` correctly identifies signature failures

#### Scenario: code property discrimination

- **WHEN** a consumer reads `err.code` on a thrown error of class `SignatureInvalid`
- **THEN** the value is the stable string `'SIGNATURE_INVALID'`

#### Scenario: EventValidation discrimination

- **WHEN** a verified payload fails its source's `schema`
- **THEN** the thrown error satisfies `err instanceof EventValidation` AND `err.code === 'EVENT_VALIDATION'`
- **AND** `err.issues` lists the schema validation issues

#### Scenario: Cross-port code parity

- **WHEN** the equivalent Go / Python / Rust port produces an error for the same failure mode
- **THEN** the error carries the same SCREAMING_SNAKE code (`'SIGNATURE_INVALID'`)
- **AND** consumers can match on `code` across language boundaries via JSON payloads

#### Scenario: Implementation-state errors are not PostelError

- **WHEN** a consumer calls a typed method whose runtime has not yet landed in the current port version (e.g., `postel.outbound.send(...)` in `@postel/core` v0.x)
- **THEN** the call throws a `NotImplementedError`
- **AND** `err instanceof NotImplementedError` is true
- **AND** `err instanceof Error` is true
- **AND** `err instanceof PostelError` is **false**
- **AND** `err.code === 'NOT_IMPLEMENTED'` for explicit discrimination
- **AND** the typical adopter catch pattern `if (err instanceof PostelError) return 4xx` does NOT match, so the error bubbles as a programming/version issue rather than being misclassified as a webhook-protocol failure

#### Scenario: Configuration errors are not PostelError

- **WHEN** a consumer misuses the library's configuration surface (e.g., calls `verify(rawBody, headers, [])` with an empty secret array, or `inbound.<source>.dedup(id)` with no ttl configured or supplied)
- **THEN** the call throws a `ConfigurationError`
- **AND** `err instanceof ConfigurationError` is true
- **AND** `err instanceof Error` is true
- **AND** `err instanceof PostelError` is **false**
- **AND** `err.code === 'CONFIGURATION_ERROR'` for explicit discrimination

#### Scenario: Configuration mistakes are not misclassified as wire errors

- **WHEN** a developer-configuration mistake (empty secret array, missing dedup ttl, non-Keyset `secretOrKeyset`, ed25519-private receiver secret, unparsable ttl, missing runtime `fetch`, unsupported `signFixture` secret) triggers a throw
- **THEN** the thrown error is `ConfigurationError`, not `MalformedHeader`
- **AND** the `PostelErrorCode`-keyed HTTP status mapping does not resolve a status for it, so an admin or gate handler surfaces it on its 500/throw path rather than as a 400

### Requirement: No string matching on errors

Public error contracts SHALL be discriminated by class identity or a stable typed `code`/`name` property — never by message string.

#### Scenario: Stable code property

- **WHEN** a consumer reads `err.code` on a thrown `PostelError`
- **THEN** the value is a stable enum-like string documented in the API reference

### Requirement: Effect-TS layer

The library SHALL provide an Effect-TS adapter (`@postel/effect`) exposing every public API as an `Effect`. The adapter MUST be a first-class layer, not a callback-style afterthought.

**Interim (TypeScript port):** the adapter has not shipped. `@postel/effect` is a pre-alpha placeholder today — it exports only `__postelPackage`, is `private`, and is not part of the 1.0 published package set, so adopters cannot install an empty package and mistake it for the layer. See *Empty placeholder packages are pre-alpha and unpublished* in `distribution-packaging-typescript`. The name is reserved so the layer lands under `@postel/effect` when it ships.

#### Scenario: Effect program composes

- **WHEN** an Effect-TS user writes `pipe(postelEffect.send(...), Effect.flatMap(...))`
- **THEN** the program type-checks and runs without bridging utilities

### Requirement: All writes accept an optional transaction parameter

Every TS write API (e.g., `outbound.send`, `outbound.endpoints.create`, `outbound.endpoints.update`, `outbound.tenants.delete`, `inbound.<source>.dedup`) SHALL accept an optional `tx` (transaction) parameter so the operation can participate in a host transaction. The parameter name is `tx` everywhere; the value type is whatever transaction handle the configured storage adapter accepts.

#### Scenario: Transactional create

- **WHEN** the host wraps `outbound.endpoints.create({...}, { tx })` in its transaction
- **THEN** the row is committed/rolled back together with the host's transaction

#### Scenario: Inbound dedup inside a transaction

- **WHEN** the host calls `inbound.github.dedup(messageId, { ttl: '1h', tx })` inside a transaction that also performs business writes
- **THEN** the dedup record commits or rolls back atomically with the business writes

### Requirement: Verifier strategy composition

Inbound sources SHALL configure verification via a `Verifier` strategy or a `ReadonlyArray<Verifier>`. The library MUST provide at least three Verifier factory functions:

- `Secret(s: string)` — HMAC v1 with a single shared secret.
- `PublicKey(pk: string)` — Ed25519 v1a with a static public key.
- `Keyset(opts: { jwksUri, refreshEvery?, cacheTtl?, fetch? })` — Ed25519 v1a with JWKS-backed kid lookup.

When a source's `verify` slot is an array, verifiers SHALL be tried in order; the first match wins. The verify result MUST indicate which verifier matched via a `matchedVerifierIndex` field. Mixed-mode arrays (e.g., `[Secret(legacy), Keyset(newJwks)]`) MUST be supported so adopters can run cross-scheme migration windows. This generalizes the receiver capability's `Multi-secret window` requirement to cover any composition of `Verifier` strategies.

A `ConfigurationError` thrown by a verifier is a developer mistake, not evidence about the incoming signature: the composition loop SHALL rethrow it immediately — as it does `TimestampTooOld` — rather than treating that verifier as a non-match and folding the failure into `SignatureInvalid`.

#### Scenario: HMAC rotation via verifier array

- **WHEN** a source configures `verify: [Secret(NEW), Secret(OLD)]` and a request arrives signed with `OLD`
- **THEN** verification succeeds
- **AND** the result's `matchedVerifierIndex` is `1`

#### Scenario: Cross-scheme migration

- **WHEN** a source configures `verify: [Secret(LEGACY_HMAC), Keyset({ jwksUri })]` and a request arrives signed with a v1a signature whose kid resolves in the keyset
- **THEN** verification succeeds against the Keyset
- **AND** the result's `matchedVerifierIndex` is `1`

#### Scenario: No verifier matches

- **WHEN** a source configures `verify: [Secret(a), Keyset({ jwksUri })]` and none of the verifiers match the incoming signature
- **THEN** `verify()` throws `SignatureInvalid`

#### Scenario: Single verifier is equivalent to a one-element array

- **WHEN** a source configures `verify: Secret(s)` (not wrapped in an array)
- **THEN** verification behaves identically to `verify: [Secret(s)]`
- **AND** the result's `matchedVerifierIndex` is `0` on success

#### Scenario: ConfigurationError from a verifier is rethrown, not swallowed

- **WHEN** a source's verifier throws `ConfigurationError` (e.g., a custom verifier delegating to `verify()` with an empty secret array)
- **THEN** `postel.inbound.<source>.verify(...)` rejects with that `ConfigurationError` itself
- **AND** the error is not converted into `SignatureInvalid`
- **AND** no later verifier in the array is tried

### Requirement: Conditional optionality of outbound and inbound

The shape of the instance returned by `Postel({...})` SHALL be conditional on which sub-namespace slots were configured. When `outbound` is omitted from the config object, `postel.outbound` MUST NOT exist on the instance type — not merely be `undefined` at runtime. The same applies to `inbound`. TypeScript MUST report a type error if the caller references a sub-namespace they did not configure. Receivers and senders are independent capabilities; a receiver-only consumer SHALL be able to construct `Postel({ inbound: {...} })` without touching any storage adapter or outbound configuration, and vice versa.

#### Scenario: Inbound-only consumer

- **WHEN** a consumer writes `const postel = Postel({ inbound: { github: { verify: Secret(s) } } })`
- **THEN** `postel.outbound` is a TypeScript error (the property is not on the instance type)
- **AND** `postel.inbound.github.verify(body, headers)` type-checks

#### Scenario: Outbound-only consumer

- **WHEN** a consumer writes `const postel = Postel({ outbound: { storage: DrizzleStorage(db) } })`
- **THEN** `postel.inbound` is a TypeScript error (the property is not on the instance type)
- **AND** `postel.outbound.send({ type, data })` type-checks

#### Scenario: Both configured

- **WHEN** a consumer configures both `outbound` and `inbound`
- **THEN** both `postel.outbound` and `postel.inbound` exist on the instance type
- **AND** lifecycle methods (`postel.start`, `postel.stop`, `postel.health`) are present regardless

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

### Requirement: Per-source event schema validation

An inbound source MAY declare a `schema` implementing the [Standard Schema](https://github.com/standard-schema/standard-schema) v1 interface (e.g. a zod ≥3.24 schema, valibot, or arktype) that describes the event `data` payload. `@postel/core` SHALL inline the Standard Schema v1 interface and SHALL NOT take a runtime dependency on any schema library, preserving its zero-runtime-dependency guarantee per `distribution-packaging-typescript`.

When a source declares a `schema`:

- `verify()` SHALL validate the parsed `event.data` against it AFTER the signature check, and SHALL throw `EventValidation` (code `EVENT_VALIDATION`) on mismatch — see `receiver`.
- The verified result's `TData` SHALL be inferred from the schema's output type through `const` config inference, so `postel.inbound.<source>.verify(...)` and the framework adapters' typed handlers carry the payload type without a wrapper.

When a source declares no `schema`, `verify()` behaves unchanged and the result's `TData` is `unknown`.

**Conformance**: the validation OUTCOME (throw `EVENT_VALIDATION` on mismatch, pass through otherwise) is CONTRACT and shared with `receiver`. The Standard Schema interface and the schema-output type inference are TypeScript-port mechanisms; other ports MAY surface per-source payload validation through their own idioms.

#### Scenario: Schema output flows to the verified result type

- **WHEN** a source configures `schema: z.object({ id: z.string() })` and a caller awaits `postel.inbound.<source>.verify(body, headers)`
- **THEN** the result's `event.data` is typed as `{ id: string }`, not `unknown`

#### Scenario: Invalid payload throws EventValidation

- **WHEN** a verified request's `event.data` does not satisfy the source's `schema`
- **THEN** `verify()` throws `EventValidation` (code `EVENT_VALIDATION`) carrying the schema issues

#### Scenario: No schema leaves behavior unchanged

- **WHEN** a source declares no `schema`
- **THEN** `verify()` returns the parsed event unchanged and the result's `event.data` is typed `unknown`

### Requirement: Custom verifiers and the Noop escape hatch [PORT-SPECIFIC]

A `Verifier` SHALL be an open contract — an object exposing `verify(rawBody, headers, options?): Promise<VerifyResult>` — not a closed set. Adopters MAY supply their own implementation in any source's `verify` slot (`inbound: { <source>: { verify: MyVerifier(...) } }`), and a supplied verifier SHALL compose with the built-ins under the existing *Verifier strategy composition* requirement: in an array it is tried in order and the matched entry's index is reported via `matchedVerifierIndex`. The built-in `Secret` / `PublicKey` / `Keyset` factories SHALL implement this same contract.

The library SHALL additionally provide a `Noop()` verifier that returns the parsed Standard Webhooks event WITHOUT verifying the signature, enforcing the timestamp window, or requiring any signing headers. `Noop()` SHALL still parse the event envelope and SHALL NOT accept a body that is not a JSON object carrying a string `type` — its `verify` throws `MalformedHeader`, which the inbound composition loop surfaces as a rejected `verify()` call (preserving the originating error on `cause`) exactly as it does for any verifier error other than `TimestampTooOld` or `ConfigurationError`, which are rethrown immediately. So a source's `schema` validation and event-shaped handlers behave identically to a verified source. `Noop()` is for adopters who knowingly accept unauthenticated webhooks (e.g. a receiver behind a trusted network boundary).

**Conformance**: PORT-SPECIFIC. The extension *mechanism* (a TypeScript interface here; a trait, protocol, or functional type elsewhere) and the `Noop()` factory are reference-implementation ergonomics — the compliance suite does not exercise adopter-supplied verifiers. What stays CONTRACT is the verifier *composition* behaviour (array ordering and `matchedVerifierIndex`) owned by the unchanged *Verifier strategy composition* requirement, plus the built-in signing schemes a `Noop()`/custom verifier opts out of. Other ports MAY expose custom verification and a skip-verification escape hatch through their own idioms, or omit the latter.

#### Scenario: Custom verifier drives a source

- **WHEN** a source configures `verify: myVerifier`, where `myVerifier` implements the `Verifier` contract, and a request arrives
- **THEN** `myVerifier.verify(rawBody, headers, options)` decides the outcome — on success `postel.inbound.<source>.verify(...)` resolves with its event and `matchedVerifierIndex` `0`; when it throws `SignatureInvalid` the call rejects

#### Scenario: Noop accepts an unauthenticated request

- **WHEN** a source configures `verify: Noop()` and a request arrives with a missing or non-matching signature
- **THEN** `postel.inbound.<source>.verify(...)` resolves with the parsed event and does not throw `SignatureInvalid` or `TimestampTooOld`

#### Scenario: Noop still parses the envelope

- **WHEN** a source configures `verify: Noop()` and the request body is not a JSON object carrying a string `type`
- **THEN** `postel.inbound.<source>.verify(...)` rejects rather than resolving with an event
- **AND** the originating `MalformedHeader` is preserved on the rejected error's `cause`

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

