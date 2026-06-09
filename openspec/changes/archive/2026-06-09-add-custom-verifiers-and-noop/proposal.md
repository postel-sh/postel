## Why

An inbound source's `verify` slot only accepts the three built-in verifiers (`Secret`, `PublicKey`, `Keyset`); `Verifier` is a closed tagged-union *data* object the inbound loop maps back to a `SecretOrKeyset` and feeds to the built-in Standard Webhooks `verify()`. Adopters can't plug their own verification scheme (a vendor with a non-Standard-Webhooks signature, a bearer-token check), and there's no first-class way to opt out of verification when the receiver sits behind a trusted boundary.

## What Changes

- **`Verifier` becomes an open behavioral contract** — an object with a `verify(rawBody, headers, options?): Promise<VerifyResult>` method — instead of a closed `{ kind, … }` data union. Adopters MAY implement it directly: `inbound: { src: { verify: MyCustomVerifier(...) } }`. **BREAKING**: the exported `Verifier` *type* changes shape. The public surface (the factories + the `verify:` config slot) is unchanged; only code that hand-built the raw union breaks — never the documented API. Pre-1.0, acceptable.
- **`Secret` / `PublicKey` / `Keyset` keep identical signatures** and now return objects implementing the contract by delegating to the existing core `verify()`. No behavior change; they still compose in arrays (order preserved, `matchedVerifierIndex` unchanged) including mixed with custom verifiers.
- **New `Noop()` verifier** — returns the parsed Standard Webhooks event without checking the signature, the timestamp, or requiring any signing headers. It still parses the envelope (throws `MalformedHeader` on a body that isn't a JSON object with a string `type`), so per-source `schema` validation and `event`-shaped handlers keep working. For adopters who knowingly accept unauthenticated webhooks.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`api-surface-typescript`** — ADDED *Custom verifiers and the Noop escape hatch*: `Verifier` is an open contract adopters may implement, and the library provides a `Noop()` verifier. PORT-SPECIFIC (the extension mechanism and the `Noop()` factory are reference-implementation ergonomics; the cross-port composition behavior stays CONTRACT under the existing *Verifier strategy composition* requirement, which is untouched).

No change to `receiver` (its scenarios describe signature behavior, not factory extensibility) or to the existing *Verifier strategy composition* requirement ("at least three factories" is a floor that four still satisfies; custom verifiers participate in its composition rules unchanged).

## Wire-format / DB-schema impact

Wire-format: unchanged (signing, headers, and payload structure are untouched; `Noop()` and custom verifiers operate on the same envelope). DB-schema: unchanged.

## Impact

- `@postel/core`: `strategies/verify.ts` — `Verifier` interface + delegating `Secret`/`PublicKey`/`Keyset` + new `Noop()`; `inbound.ts` — `attempt()` calls `v.verify(...)`, `verifierToSecretOrKeyset` removed; new `Noop` export from `strategies/index.ts` and the core barrel.
- No change to `@postel/http`, the framework web adapters, `@postel/effect`, or `@postel/compliance-driver` — they consume the source API (`source.verify(rawBody, headers)`), never the `Verifier` internals. The compliance suite is unaffected (built-in behavior is byte-for-byte unchanged).
- Docs: `inbound/verify.mdx`, `inbound/index.mdx`, `inbound/signing.mdx`, and `reference/packages.mdx` if it enumerates the factory list.
