# Tasks

## 1. Spec

- [x] 1.1 NEW `provider-verifiers` — *Stripe signature verification*, *GitHub signature verification*, *Provider secrets are used as literal key material*.

## 2. Core implementation

- [x] 2.1 `typescript/packages/core/src/strategies/providers.ts`: `Stripe(secret, options?)` and `GitHub(secret)`, implementing the `Verifier` contract. Reuse `internal/hmac.ts`-style `crypto.subtle` HMAC-SHA256, `internal/timing.ts`'s `constantTimeEqual`, `internal/headers.ts`'s `readHeader`/`requireHeader`, `internal/event.ts`'s `bodyToText`.
- [x] 2.2 Wire `Stripe`/`GitHub` into `strategies/index.ts` and the `@postel/core` root export list.

## 3. Tests

- [x] 3.1 `typescript/packages/core/test/provider-verifiers.test.ts` — one test per scenario in the `provider-verifiers` spec, test descriptions naming the requirement, real Stripe/GitHub header and payload shapes signed under test against a known secret.

## 4. Docs

- [x] 4.1 Inbound verify docs: provider matrix (Standard Webhooks / Stripe / GitHub — header names, tolerance, replay semantics); drop the hand-write-your-own-verifier framing for these two providers.

## 5. Verify + archive

- [x] 5.1 `openspec validate add-provider-verifiers-stripe-github`; `mise run check:all`.
- [x] 5.2 `@postel/core` typecheck/test/lint/build chain.
- [x] 5.3 `openspec archive add-provider-verifiers-stripe-github -y`.
- [x] 5.4 PR referencing #136 and the `provider-verifiers` capability.
