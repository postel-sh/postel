# Tasks

## 1. Spec

- [x] 1.1 ADDED `provider-verifiers` — *Shopify signature verification*, *Twilio signature verification*, *Slack signature verification*.
- [x] 1.2 MODIFIED `provider-verifiers` — *Provider secrets are used as literal key material* broadened to Shopify/Twilio/Slack.

## 2. Core implementation

- [x] 2.1 `typescript/packages/core/src/strategies/providers.ts`: `Shopify(secret)`, `Twilio(authToken, url)`, `Slack(signingSecret, options?)`, implementing the `Verifier` contract. Reuse `internal/timing.ts`'s `constantTimeEqual`, `internal/headers.ts`'s `requireHeader`, `internal/event.ts`'s `bodyToText`; extend the HMAC helper to take a hash-name parameter for Twilio's SHA-1.
- [x] 2.2 Wire `Shopify`/`Twilio`/`Slack` into `strategies/index.ts` and the `@postel/core` root export list.

## 3. Tests

- [x] 3.1 `typescript/packages/core/test/provider-verifiers.test.ts` — one test per scenario in the `provider-verifiers` spec delta, test descriptions naming the requirement, real Shopify/Twilio/Slack header and payload shapes signed under test against a known secret.

## 4. Docs

- [x] 4.1 Inbound verify docs: three new provider-matrix rows (Shopify/Twilio/Slack — header names, tolerance, replay semantics).

## 5. Verify + archive

- [x] 5.1 `openspec validate add-provider-verifiers-shopify-twilio-slack`; `mise run check:all`.
- [x] 5.2 `@postel/core` typecheck/test/lint/build chain.
- [x] 5.3 `openspec archive add-provider-verifiers-shopify-twilio-slack -y`.
- [x] 5.4 PR referencing #137 and the `provider-verifiers` capability.
