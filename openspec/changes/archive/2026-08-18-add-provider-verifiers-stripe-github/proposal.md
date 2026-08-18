## Why

All four shipped verifiers (`Secret`, `PublicKey`, `Keyset`, `Noop`) speak only the Standard Webhooks header scheme (`webhook-id` / `webhook-timestamp` / `webhook-signature`). The two highest-volume real-world inbound sources do not: Stripe signs with `Stripe-Signature` (`t=`/`v1=`), GitHub with `X-Hub-Signature-256`. Every adopter receiving from either must hand-write a custom `Verifier` — including timestamp/replay handling — for exactly the "verify signatures correctly the first time" persona VISION.md names. Closes #136.

## What Changes

- New built-in `Verifier` factories `Stripe(secret, options?)` and `GitHub(secret)` in `@postel/core`, implementing the existing open `Verifier` contract (`verify(rawBody, headers, options?): Promise<VerifyResult>`) — they compose with `Secret`/`PublicKey`/`Keyset`/custom verifiers via the existing array/map composition loop with no changes to that loop.
- Each provider's own header scheme, HMAC canonicalization, timestamp-tolerance/replay semantics, and event-shape mapping are implemented exactly as that provider defines them — NOT coerced through the Standard Webhooks `webhook-*` header/secret conventions.
- Recorded-fixture tests using real Stripe/GitHub header and payload shapes (field names, header formats) with signatures computed under test against a known secret.
- Docs: the inbound verify page gains a provider matrix (Standard Webhooks / Stripe / GitHub: header names, tolerance, replay semantics) — this also permanently fixes the "hand-write your own verifier" quickstart framing from #117.
- Shopify, Twilio, and Slack are explicitly OUT of scope (tracked separately in #137).

## Capabilities

### New Capabilities

- **`provider-verifiers`** — per-provider inbound signature verification: header scheme, HMAC canonicalization, timestamp tolerance and replay semantics, and event-shape mapping, for Stripe and GitHub. The verified OUTCOME (a real Stripe/GitHub-signed request is accepted, a forged or stale one is rejected with the correct `PostelError`) is CONTRACT; the TypeScript factory names (`Stripe`, `GitHub`) are the port mechanism.

### Modified Capabilities

None. `Stripe`/`GitHub` are additional `Verifier` implementations under the existing *Verifier strategy composition* and *Custom verifiers... open contract* requirements in `api-surface-typescript` — those requirements already describe composition generically and are unchanged by adding more built-in factories.

## Wire-format / DB-schema impact

None. This is inbound verification of third-party-signed requests; it does not touch Postel's own produced wire format (`specs/wire-format/asyncapi.yaml`) or DB schema.

## Impact

- `@postel/core`: new public exports `Stripe`, `GitHub` (strategies), reusing internal `constantTimeEqual`, HMAC-via-`crypto.subtle`, and header-reading helpers already in `internal/`. No new runtime dependency — this is why the home is `@postel/core`, not a new `@postel/verifiers` package (see `design.md`).
- Docs: `docs/content/docs/inbound/` gains a provider matrix page/section.
- Tests: `typescript/packages/core/test/provider-verifiers.test.ts`.
