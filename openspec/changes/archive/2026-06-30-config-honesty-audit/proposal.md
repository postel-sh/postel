## Why

Milestone **M1 — Truth & Trust** ("No config silently lies. Every unimplemented strategy fails fast at construction.") is a go-live blocker. An audit of the TypeScript port's config surface (issue #78, with siblings #76 and #77) found accepted-but-ignored fields: a host can configure them, the call succeeds, and the configured behavior never happens — no signal.

Traced field-by-field against the runtime, the phantom fields are:

| Field | Capability of record (currently deferred) |
|---|---|
| `OutboundConfig.kms` (`aws-kms` / `gcp-kms` / `vault`) | key-management · *Encryption at rest with KMS adapter* — issue #76 |
| `PostelConfig.observability` (`logger` / `otel` / `metrics`) | observability — issue #77 |
| `OutboundConfig.retention` | observability · *Configurable retention with automatic pruning* |
| `OutboundConfig.ephemeralKeys` | key-management · *Ephemeral keys via auto-rotation* |
| `HttpDefaults.tls` (`verify`) | sender · *TLS verification by default* (the opt-out is unwired) |
| `HttpDefaults.dns` (`pinResolution`) | sender · *DNS rebinding protection* |

The `workers` slot already fails fast for non-`in-process` strategies — that is the established precedent this change generalizes.

Two honest resolutions, decided per issue:
- **Fail fast** (keep the typed slot, throw `NotImplementedError` at construction) for the unbuilt *strategy/feature* slots — `kms`, `retention`, `ephemeralKeys`, `http.tls`, `http.dns`. This matches `workers` and #76's locked decision, and keeps the roadmap visible in the type surface.
- **Wire a minimal pass-through** for the one genuinely passive field: `observability.logger` now receives the library's real delivery/circuit events; the inert `otel` / `metrics` keys (whole capabilities, not yet built) are dropped from the 1.0 config shape.

The specs are the source of truth and currently describe these features as already working (e.g. key-management says secrets "SHALL be encrypted at rest"). Per workflow rule 1, this change reconciles the specs with the shipped reality *before* the implementation lands, rather than letting the code silently contradict them.

## What Changes

- **api-surface-typescript**
  - ADD `Unimplemented config slots fail fast at construction` [PORT-SPECIFIC] — the single home for the "typed slot, runtime not yet shipped → `NotImplementedError`" contract, with scenarios for `kms`, `retention`, `ephemeralKeys`, `http.tls`, `http.dns`, and the passing case (`PlaintextKms` + a fully-wired config construct without throwing).
  - MODIFY `Outbound defaults are overridable per endpoint` — `http` stays overridable for its wired sub-fields (`requestTimeout`, `overallDeadline`, `ssrf`, `userAgent`); the per-endpoint TLS opt-out scenario is removed because `http.tls` now fails fast (it moves under the new requirement).
- **observability**
  - ADD `Logger pass-through for runtime events` [PORT-SPECIFIC] — `observability.logger` receives `attempt` / `circuit-open` / `circuit-close` / `dead-letter` events with a severity level.
  - MODIFY `Configurable retention with automatic pruning` — interim note: the `retention` config slot fails fast until pruning ships.
- **key-management**
  - MODIFY `Encryption at rest with KMS adapter` — interim note: configuring a built-in KMS adapter throws `NotImplementedError` until envelope encryption ships; `PlaintextKms` is the only accepted strategy.
  - MODIFY `Ephemeral keys via auto-rotation` — interim note: the `ephemeralKeys` slot fails fast until timer-driven rotation ships.
- **sender**
  - MODIFY `TLS verification by default` — interim note: TLS-on is the runtime default (Node fetch); the per-endpoint `http.tls` opt-out is not yet wired and fails fast.
  - MODIFY `DNS rebinding protection` — interim note: the `http.dns.pinResolution` slot is not yet wired and fails fast.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api-surface-typescript` — one ADDED requirement (fail-fast), one MODIFIED requirement (per-endpoint overrides drop the TLS opt-out scenario).
- `observability` — one ADDED requirement (logger pass-through), one MODIFIED requirement (retention interim note).
- `key-management` — two MODIFIED requirements (KMS + ephemeral interim notes).
- `sender` — two MODIFIED requirements (TLS + DNS interim notes).

### Removed Capabilities

None.

## Wire-format / DB-schema impact

Wire-format: unchanged. DB-schema: unchanged. No row shapes or headers change; this is a construction-time validation + a public-type adjustment.

## Impact

- `typescript/packages/core/src/outbound.ts` — `buildOutboundRuntime` fails fast on `kms` (non-`plaintext`), `retention`, `ephemeralKeys`, and a shared `http.tls` / `http.dns` assertion.
- `typescript/packages/core/src/sender/endpoint/crud.ts` — `create` / `update` reuse the same `http.tls` / `http.dns` fail-fast assertion for per-endpoint overrides.
- `typescript/packages/core/src/postel.ts` — `ObservabilityConfig` becomes `{ logger?: Logger }`; new `Logger` / `LogEvent` types; `Postel()` forwards emitter events to `observability.logger`.
- `typescript/packages/core/src/index.ts` — exports `Logger`, `LogEvent`.
- `typescript/packages/core/test/config-audit.test.ts` — new test naming the two ADDED requirements + the field→consumer mapping (#78 deliverable).
- `docs/content/docs/outbound/index.mdx`, `docs/content/docs/index.mdx` — KMS/observability rows realigned (rule 8).
- The deferred requirements (`Encryption at rest with KMS adapter`, `Ephemeral keys via auto-rotation`, `Configurable retention with automatic pruning`, `TLS verification by default`, `DNS rebinding protection`) remain in `scripts/spec-drift-deferred.txt` — their *runtime* is still unshipped; only the interim fail-fast contract is documented now.
