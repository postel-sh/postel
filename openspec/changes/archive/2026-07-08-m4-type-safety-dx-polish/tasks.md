# Tasks

## 1. Spec

- [ ] 1.1 `api-surface-typescript`: ADD *Typed lifecycle event emitter*, ADD *`definePostelConfig` preserves literal config inference*, MODIFY *Custom verifiers and the Noop escape hatch*.
- [ ] 1.2 `observability`: MODIFY *Health check endpoint* (unhealthy conditions + thresholds).
- [ ] 1.3 `receiver`: ADD *Multi-verifier failures are aggregated*, ADD *Consumed raw body surfaces a descriptive configuration error*.

## 2. Core — #89 typed events

- [ ] 2.1 `sender/events.ts`: add `PostelEventMap`; type `on<E>`/`off<E>`/`emit<E>`; `on` returns `Unsubscribe`.
- [ ] 2.2 `postel.ts`: `LifecycleApi.on/off` generic; `on` returns `Unsubscribe`; internal logger wiring stays typed.
- [ ] 2.3 `index.ts`: export `PostelEventMap`, `DeadLetterPayload`, `AttemptPayload`, `CircuitTransitionPayload`.

## 3. Core — #90 definePostelConfig

- [ ] 3.1 `postel.ts`: add `definePostelConfig<const C extends PostelConfig>(config: C): C`.
- [ ] 3.2 `index.ts`: export `definePostelConfig`.

## 4. Core — #91 health()

- [ ] 4.1 `postel.ts`: `ObservabilityConfig.health?: { maxOutboxDepth?; maxOldestPendingAge? }`; `HealthStatus.reason?`.
- [ ] 4.2 `health()`: storage-probe failure → `{ ok: false, reason }`; threshold breach → `{ ok: false, reason, … }`.

## 5. Core — #93 multi-verifier aggregation

- [ ] 5.1 `errors.ts`: `VerifierFailure` type; optional `errors` on `PostelError` via options.
- [ ] 5.2 `inbound.ts`: collect failures; unanimous `MalformedHeader` → `MalformedHeader`, else `SignatureInvalid`; attach `errors` + `AggregateError` cause.
- [ ] 5.3 `index.ts`: export `VerifierFailure`.

## 6. Express — #92

- [ ] 6.1 `frameworks/express/src/index.ts`: `rawBuffer` throws `ConfigurationError` (body-parser ordering) when body is not a `Uint8Array`.

## 7. Tests (1:1 with scenarios)

- [ ] 7.1 Core: typed `on`/`off` + `Unsubscribe` + payload-type correlation; exported payload types.
- [ ] 7.2 Core: `definePostelConfig` preserves `inbound`/`outbound` on the instance type.
- [ ] 7.3 Core: `health()` unhealthy on storage probe failure and threshold breach; healthy otherwise.
- [ ] 7.4 Core: multi-verifier `errors` aggregation; unanimous `MalformedHeader`; update Noop envelope tests.
- [ ] 7.5 Express: consumed body → descriptive `ConfigurationError` (5xx), not `SIGNATURE_INVALID` (400).

## 8. Docs

- [ ] 8.1 Getting-started: `definePostelConfig` / inline / `as const satisfies` rule.
- [ ] 8.2 Events + health pages reflect typed `on` and unhealthy conditions.

## 9. Verify + archive

- [ ] 9.1 `mise run check:all`; in `typescript/`: `pnpm typecheck test lint build`.
- [ ] 9.2 `openspec validate m4-type-safety-dx-polish --strict`; `openspec archive m4-type-safety-dx-polish -y`.
- [ ] 9.3 PR referencing the capabilities; `Closes #89 #90 #91 #92 #93`.
