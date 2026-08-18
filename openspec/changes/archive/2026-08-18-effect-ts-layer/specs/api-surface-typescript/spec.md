## RENAMED Requirements

- FROM: `### Requirement: Effect-TS layer`
- TO: `### Requirement: Effect-TS layer [PORT-SPECIFIC]`

## MODIFIED Requirements

### Requirement: Effect-TS layer [PORT-SPECIFIC]

The library SHALL provide an Effect-TS adapter (`@postel/effect`) that is a first-class layer, not a callback-style afterthought:

- `PostelLive(config)` builds a scoped `Layer` — acquiring it constructs the Postel instance and starts its outbound worker pool (`instance.start()`); releasing the layer's `Scope` gracefully stops it (`instance.stop()`). An Effect program never calls the Promise-based `start`/`stop` lifecycle methods directly.
- `PostelTag()` identifies the Effect-wrapped service in `Context`, so it is acquired via `Effect.gen`/`Layer.provide` rather than constructed directly.
- `send`, `replay`, `messages.get`/`messages.attempts`/`messages.list`, and each configured inbound source's `verify` are exposed as `Effect`-returning methods (`PostelEffectApi`) instead of Promise-returning ones.
- `PostelError` subclasses, `ConfigurationError`, and `NotImplementedError` are the adapter's typed error channel (`PostelErrors`): these fail the `Effect` rather than rejecting a `Promise`. An error outside that set (a programmer mistake, not a Postel business error) surfaces as an `Effect` defect instead of being folded into the typed channel.

**Conformance**: PORT-SPECIFIC. Effect-TS is a TypeScript-ecosystem concept with no cross-port analogue; other language ports have no equivalent requirement. The behaviors the layer wraps (send/verify/replay/message-introspection semantics, error codes) remain CONTRACT under `sender`/`receiver`/`message-introspection` — this requirement only governs how the TypeScript port exposes them idiomatically to Effect-TS consumers.

#### Scenario: Effect program composes

- **WHEN** an Effect-TS user writes `pipe(postelEffect.send(...), Effect.flatMap(...))`
- **THEN** the program type-checks and runs without bridging utilities

#### Scenario: Acquiring the layer starts the worker pool; releasing stops it

- **WHEN** an Effect program runs with `PostelLive(config)` provided and the scope subsequently closes
- **THEN** the outbound worker pool is running for the lifetime of the scope
- **AND** it is stopped once the scope closes, with no further dispatch attempts afterward

#### Scenario: PostelError surfaces through the typed error channel

- **WHEN** `verify` rejects with a `SignatureInvalid` on the Promise-based `@postel/core` API
- **THEN** the Effect-wrapped `verify` fails the `Effect` with that same `SignatureInvalid` instance, satisfying `Effect.catchTag`/`Effect.catchAll` on the typed channel, rather than throwing or rejecting

#### Scenario: An Effect user never touches the Promise API

- **WHEN** an Effect-TS user acquires Postel via `PostelLive` and drives `send`, `inbound.<source>.verify`, `messages.list`, and `replay` entirely through the returned `PostelEffectApi`
- **THEN** the program never calls `.then`/`await` against a `@postel/core` Promise-returning method
