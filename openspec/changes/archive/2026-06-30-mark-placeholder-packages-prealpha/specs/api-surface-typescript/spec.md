## MODIFIED Requirements

### Requirement: Effect-TS layer

The library SHALL provide an Effect-TS adapter (`@postel/effect`) exposing every public API as an `Effect`. The adapter MUST be a first-class layer, not a callback-style afterthought.

**Interim (TypeScript port):** the adapter has not shipped. `@postel/effect` is a pre-alpha placeholder today — it exports only `__postelPackage`, is `private`, and is not part of the 1.0 published package set, so adopters cannot install an empty package and mistake it for the layer. See *Empty placeholder packages are pre-alpha and unpublished* in `distribution-packaging-typescript`. The name is reserved so the layer lands under `@postel/effect` when it ships.

#### Scenario: Effect program composes

- **WHEN** an Effect-TS user writes `pipe(postelEffect.send(...), Effect.flatMap(...))`
- **THEN** the program type-checks and runs without bridging utilities
