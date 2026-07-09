## MODIFIED Requirements

### Requirement: Verifier strategy composition

Inbound sources SHALL configure verification via a `Verifier` strategy, a `ReadonlyArray<Verifier>`, or a named map (`Record<string, Verifier>`). The library MUST provide at least three Verifier factory functions:

- `Secret(s: string)` — HMAC v1 with a single shared secret.
- `PublicKey(pk: string)` — Ed25519 v1a with a static public key.
- `Keyset(opts: { jwksUri, refreshEvery?, cacheTtl?, fetch? })` — Ed25519 v1a with JWKS-backed kid lookup.

When a source's `verify` slot is an array, verifiers SHALL be tried in order; the first match wins. The verify result MUST indicate which verifier matched via a `matchedVerifierIndex` field. Mixed-mode arrays (e.g., `[Secret(legacy), Keyset(newJwks)]`) MUST be supported so adopters can run cross-scheme migration windows. This generalizes the receiver capability's `Multi-secret window` requirement to cover any composition of `Verifier` strategies.

When a source's `verify` slot is a named map, verifiers SHALL be tried in the map's iteration order (insertion order, per `Object.entries` semantics); the first match wins exactly as with an array. The verify result MUST indicate which verifier matched via BOTH `matchedVerifierIndex` (its position in iteration order) AND `matchedVerifier` (the string key that matched). `matchedVerifier` is absent — not present with an `undefined` value — when the source's `verify` slot is a single `Verifier` or an array, since neither form has names to report.

A `ConfigurationError` thrown by a verifier is a developer mistake, not evidence about the incoming signature: the composition loop SHALL rethrow it immediately — as it does `TimestampTooOld` — rather than treating that verifier as a non-match and folding the failure into `SignatureInvalid`. This applies identically regardless of which of the three `verify` forms is configured.

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

#### Scenario: Named-map verifier reports the matched name

- **WHEN** a source configures `verify: { current: Secret(NEW), legacy: Secret(OLD) }` and a request arrives signed with `OLD`
- **THEN** verification succeeds
- **AND** the result's `matchedVerifier` is `"legacy"`
- **AND** the result's `matchedVerifierIndex` is `1`

#### Scenario: Named-map verifier composes with cross-scheme migration

- **WHEN** a source configures `verify: { hmac: Secret(LEGACY_HMAC), jwks: Keyset({ jwksUri }) }` and a request arrives signed with a v1a signature whose kid resolves in the keyset
- **THEN** verification succeeds against the Keyset
- **AND** the result's `matchedVerifier` is `"jwks"`

#### Scenario: Array and single-verifier forms carry no matchedVerifier key

- **WHEN** a source configures `verify: [Secret(s)]` or `verify: Secret(s)` and verification succeeds
- **THEN** `"matchedVerifier" in result` is `false`

#### Scenario: Named-map ConfigurationError rethrow

- **WHEN** a source's named-map verifier throws `ConfigurationError`
- **THEN** `postel.inbound.<source>.verify(...)` rejects with that `ConfigurationError` itself, identically to the array form
