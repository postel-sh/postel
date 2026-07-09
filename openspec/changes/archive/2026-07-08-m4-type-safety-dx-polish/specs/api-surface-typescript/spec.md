## ADDED Requirements

### Requirement: Typed lifecycle event emitter [PORT-SPECIFIC]

`postel.on(event, handler)` SHALL correlate the event name to its payload type through a `PostelEventMap` interface, so a handler's parameter is the payload type for that event, not `unknown`. The canonical map is:

| Event | Payload type |
|---|---|
| `dead-letter` | `DeadLetterPayload` |
| `attempt` | `AttemptPayload` |
| `circuit-open` | `CircuitTransitionPayload` |
| `circuit-close` | `CircuitTransitionPayload` |

`on` SHALL return an `Unsubscribe` (the `() => void` idiom already used across the surface) that removes the registered handler, not `void`. `off(event, handler)` SHALL be typed by the same map. The payload types (`DeadLetterPayload`, `AttemptPayload`, `CircuitTransitionPayload`) and `PostelEventMap` SHALL be exported from the package root. Because `PostelEventMap` is an interface keyed by event name, adding a new event is a non-breaking addition.

**Conformance**: PORT-SPECIFIC. The `PostelEventMap` interface, the `Unsubscribe` return, and the generic `on`/`off` signatures are TypeScript type-system mechanisms; the durable intent — a host can subscribe to delivery/circuit events and later unsubscribe — is shared, but other ports expose it through their own idioms. The compliance suite does not exercise the event emitter.

#### Scenario: Event name correlates to payload type

- **WHEN** a consumer writes `postel.on('dead-letter', (p) => …)`
- **THEN** `p` is typed `DeadLetterPayload` (its `messageId`, `endpointId`, `finalError` are available without a cast)
- **AND** `postel.on('attempt', (p) => …)` types `p` as `AttemptPayload`

#### Scenario: on returns an Unsubscribe

- **WHEN** a consumer calls `const off = postel.on('attempt', handler)` and later `off()`
- **THEN** `off` has type `Unsubscribe` and invoking it stops `handler` from receiving further `attempt` events

#### Scenario: Payload types are exported

- **WHEN** a consumer imports `DeadLetterPayload`, `AttemptPayload`, `CircuitTransitionPayload`, and `PostelEventMap` from the package root
- **THEN** the imports resolve to the exported types

### Requirement: `definePostelConfig` preserves literal config inference [PORT-SPECIFIC]

Annotating a config with the `PostelConfig` type before passing it to `Postel(...)` widens the literal, so the `WithInbound` / `WithOutbound` instance-type conditionals can no longer see the configured slots and `postel.inbound` / `postel.outbound` vanish from the instance type. The library SHALL provide a `definePostelConfig()` identity helper — `<const C extends PostelConfig>(config: C): C` — that preserves the literal so a config declared separately keeps full instance typing. The helper SHALL be exported from the package root.

**Conformance**: PORT-SPECIFIC. `definePostelConfig` exists to work around TypeScript `const`-inference erasure and is a TypeScript-port ergonomic; other ports have no equivalent hazard.

#### Scenario: definePostelConfig keeps inbound/outbound on the instance type

- **WHEN** a consumer writes `const config = definePostelConfig({ inbound: { github: { verify: Secret(s) } } })` and `const postel = Postel(config)`
- **THEN** `postel.inbound.github.verify(body, headers)` type-checks exactly as it would for an inlined config
- **AND** the same holds for a `definePostelConfig({ outbound: { storage } })` config and `postel.outbound`

## MODIFIED Requirements

### Requirement: Custom verifiers and the Noop escape hatch [PORT-SPECIFIC]

A `Verifier` SHALL be an open contract — an object exposing `verify(rawBody, headers, options?): Promise<VerifyResult>` — not a closed set. Adopters MAY supply their own implementation in any source's `verify` slot (`inbound: { <source>: { verify: MyVerifier(...) } }`), and a supplied verifier SHALL compose with the built-ins under the existing *Verifier strategy composition* requirement: in an array it is tried in order and the matched entry's index is reported via `matchedVerifierIndex`. The built-in `Secret` / `PublicKey` / `Keyset` factories SHALL implement this same contract.

The library SHALL additionally provide a `Noop()` verifier that returns the parsed Standard Webhooks event WITHOUT verifying the signature, enforcing the timestamp window, or requiring any signing headers. `Noop()` SHALL still parse the event envelope and SHALL NOT accept a body that is not a JSON object carrying a string `type` — its `verify` throws `MalformedHeader`. When `Noop()` is the only configured verifier, that `MalformedHeader` is the sole verifier failure and therefore surfaces from `postel.inbound.<source>.verify(...)` as a `MalformedHeader` per *Multi-verifier failures are aggregated* in `receiver` (a unanimous `MalformedHeader` surfaces as itself rather than `SignatureInvalid`), with the originating error exposed on the rejected error's `errors` and its `AggregateError` `cause`. As before, `TimestampTooOld` and `ConfigurationError` are rethrown immediately by the composition loop. So a source's `schema` validation and event-shaped handlers behave identically to a verified source. `Noop()` is for adopters who knowingly accept unauthenticated webhooks (e.g. a receiver behind a trusted network boundary).

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
- **AND** the rejected error is a `MalformedHeader` whose `errors` and `AggregateError` `cause` preserve the originating `MalformedHeader`
