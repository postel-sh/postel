## ADDED Requirements

### Requirement: Custom verifiers and the Noop escape hatch [PORT-SPECIFIC]

A `Verifier` SHALL be an open contract — an object exposing `verify(rawBody, headers, options?): Promise<VerifyResult>` — not a closed set. Adopters MAY supply their own implementation in any source's `verify` slot (`inbound: { <source>: { verify: MyVerifier(...) } }`), and a supplied verifier SHALL compose with the built-ins under the existing *Verifier strategy composition* requirement: in an array it is tried in order and the matched entry's index is reported via `matchedVerifierIndex`. The built-in `Secret` / `PublicKey` / `Keyset` factories SHALL implement this same contract.

The library SHALL additionally provide a `Noop()` verifier that returns the parsed Standard Webhooks event WITHOUT verifying the signature, enforcing the timestamp window, or requiring any signing headers. `Noop()` SHALL still parse the event envelope and SHALL NOT accept a body that is not a JSON object carrying a string `type` — its `verify` throws `MalformedHeader`, which the inbound composition loop surfaces as a rejected `verify()` call (preserving the originating error on `cause`) exactly as it does for any non-`TimestampTooOld` verifier error. So a source's `schema` validation and event-shaped handlers behave identically to a verified source. `Noop()` is for adopters who knowingly accept unauthenticated webhooks (e.g. a receiver behind a trusted network boundary).

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
