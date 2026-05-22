## Why

The current `api-surface-typescript` spec describes `Postel({ db, ...opts })` returning a fully-typed instance with **flat methods**: `send`, `verify`, `start`, `endpoints`, `keys`, `tenants`, `replay`, `reconcile`, `dedup`, `jwksHandler`, `health`, `on`. This shape has surfaced concrete problems as implementation work has started:

1. **No place for per-source receiver config.** Hosts that receive webhooks from multiple upstreams (Stripe AND GitHub) want per-source secrets, per-source dedup adapters, per-source rotation windows. The flat shape forces secret/dedup-adapter arguments on every `verify()` call instead of binding them at construction.
2. **Outbound and inbound conflated.** Receiver concerns (verify, dedup, JWKS consumer) and sender concerns (send, endpoints, keys, replay, dispatch workers) share one method namespace despite being orthogonal in both deployment shape (most apps do one or the other primarily) and config shape (sender needs storage + retry + KMS; receiver needs verifiers + dedup).
3. **Pre-sender factory is awkward.** Until sender lands, 9 of 12 methods don't exist. Shipping them as stubs is misleading; omitting them (per PR #29) leaves the type narrower than the spec.
4. **No composable extension points.** Verification today is `verify(body, headers, secretOrKeyset)` — the union type covers HMAC and JWKS but can't compose cross-scheme migration (`[Secret(legacy), Keyset(new)]`), nor extend to future schemes (mTLS, OAuth, custom).

This change restructures the factory into **`outbound` + `inbound` sub-namespaces** with **strategy-pattern composition** for the configurable plug-points (verify, dedup, signing, retry, workers, KMS). Both sub-namespaces are independently optional with conditional types — edge-only consumers configure just `inbound` and `postel.outbound` is not on the type.

## What Changes

- Factory shape becomes `Postel({ observability?, outbound?, inbound? })`. All three slots optional; conditional types narrow the returned instance to exactly what was configured.
- **`postel.outbound.*`** holds sender methods: `send`, `endpoints.{create,update,delete,list,get,disable,rotateSecret}`, `keys.{generateSymmetric,generateAsymmetric}`, `tenants.{setRateLimit,delete}`, `replay`, `reconcile`.
- **`postel.inbound.<sourceKey>.*`** holds receiver methods per configured source: `verify`, `dedup` (if a dedup adapter is configured for that source).
- Lifecycle stays at the top: `postel.start()`, `postel.stop()`, `postel.health()`.
- **Strategy pattern** for composable plug-points. All strategies are factory functions returning tagged config objects:
  - **Verifiers**: `Secret(s)`, `PublicKey(pk)`, `Keyset(opts)`. A source's `verify` slot accepts one `Verifier` or `ReadonlyArray<Verifier>` (first-match-wins).
  - **Dedup adapters**: `InMemoryDedup()`, plus per-storage-package adapters (e.g., `DrizzleDedup(db)`, `PostgresDedup(db)`, `RedisDedup(redis)`).
  - **Signing strategies**: `HmacV1()`, `Ed25519V1a()`.
  - **Retry strategies**: `ExponentialBackoff({...})`, `LinearBackoff({...})`, `Custom(fn)`.
  - **Worker strategies**: `InProcess({ concurrency })`, `BullMQ(queue)`, `PgBoss(boss)`.
  - **KMS strategies**: `AwsKms({...})`, `GcpKms({...})`, `Vault({...})`, `PlaintextKms()`.
- **Verifier composition** supports mixed-mode arrays — `[Secret(legacy), Keyset(new)]` enables cross-scheme migration windows (HMAC → Ed25519/JWKS). The receiver capability's multi-secret-window requirement generalizes to multi-verifier-window.
- **Outbound defaults are overridable per endpoint** — `signing`, `retryPolicy`, `circuitBreaker`, `autoDisable`, `http` are configured org-wide on `outbound.*` and override-able on each `endpoints.create({...})` call. Resolution order: per-endpoint > org-default > library default.
- Transaction parameter naming standardizes on `tx` everywhere (consistent with the spec's "host-transaction passthrough" prose and the standalone-pg adapter's existing test code).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`api-surface-typescript`**:
  - `Postel factory returns the library instance` — body and scenarios rewritten for the sub-namespaced shape.
  - `Public function signatures match Standard Webhooks event shape` — scenario updates `postel.send<...>` to `postel.outbound.send<...>`.
  - `All writes accept an optional transaction parameter` — scenario updates the example, renames `db` parameter to `tx` for accuracy.
  - **Added**: `Verifier strategy composition`.
  - **Added**: `Conditional optionality of outbound and inbound`.
  - **Added**: `Outbound defaults are overridable per endpoint`.

### Removed Capabilities

None.

## Wire-format / DB-schema impact

Wire-format: unchanged.
DB-schema: unchanged.

## Impact

- `openspec/specs/api-surface-typescript/spec.md` — three existing requirements rewritten, three new requirements added (applied via archive).
- `typescript/packages/core/src/` — refactored against the new spec. New `postel.ts` factory with conditional types; new `strategies/` modules; `outbound` runtime methods throw `NotImplementedError` until sender lands; `inbound` delegates to `@postel/edge`.
- `typescript/packages/core/test/` — rewritten for the new shape.
- `typescript/packages/core/README.md` — rewritten.
- `decisions/0012-package-granularity.md` — light addendum noting the factory's sub-namespaced shape.
- `scripts/spec-drift-deferred.txt` — adjusted to reflect newly covered + newly deferred requirements.
- `typescript/packages/edge/` — unchanged. The edge package's flat named-export surface stays as-is (it's appropriate for the bundle-size carve-out).
- `@postel/standalone-pg`, `@postel/drizzle`, etc. — unchanged for now; they continue to export `postelDrizzle(db)`-style factories that the `outbound.storage` slot consumes.
