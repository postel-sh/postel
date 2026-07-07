## MODIFIED Requirements

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
