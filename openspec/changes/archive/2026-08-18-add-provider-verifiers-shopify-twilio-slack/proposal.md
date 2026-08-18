## Why

Wave 1 (#136) shipped `Stripe`/`GitHub` built-in `Verifier` factories. The next tier of high-volume inbound senders uses three more non-Standard-Webhooks schemes: Shopify (`X-Shopify-Hmac-Sha256`), Twilio (`X-Twilio-Signature`, URL+params HMAC), Slack (`X-Slack-Signature`, `v0` timestamp scheme). Adopters receiving from any of these must still hand-write a custom `Verifier` today. Closes #137.

## What Changes

- New built-in `Verifier` factories `Shopify(secret)`, `Twilio(authToken, url)`, `Slack(signingSecret, options?)` in `@postel/core`, implementing the existing open `Verifier` contract — same `strategies/` home, same array/map composition loop, no changes to that loop.
- Each provider's own header scheme, HMAC canonicalization, timestamp-tolerance/replay semantics, and event-shape mapping are implemented exactly as that provider defines them, per the same design constraint wave 1 established.
- `Twilio` needs one input the other providers don't: the exact webhook endpoint URL Twilio POSTed to, since Twilio's signature is computed over `url + sorted-concatenated form params`, not the raw body alone. This is a new mandatory constructor argument (`Twilio(authToken, url)`), not a `Verifier` interface change — verified via a new requirement rather than special-cased in code.
- `Twilio`'s wire format (`application/x-www-form-urlencoded`, no JSON envelope, no per-request event-type field or header) carries no event-type discriminator at all, unlike Stripe (body `type`), GitHub (`X-GitHub-Event` header), Shopify (`X-Shopify-Topic` header), or Slack (body `type`). `Twilio` SHALL report a fixed `type: "twilio.webhook"`; the parsed form parameters are the event `data`, and callers key off `data` fields (e.g. `MessageStatus`, `CallStatus`) or a `schema` for further routing — the same pattern the receiver capability already supports.
- *Provider secrets are used as literal key material* (wave 1) is broadened to also cover `Shopify`/`Twilio`/`Slack`.
- Recorded-fixture tests using real Shopify/Twilio/Slack header and payload shapes, signatures computed under test against a known secret.
- Docs: three new provider-matrix rows on the inbound verify page.

## Capabilities

### Modified Capabilities

- **`provider-verifiers`** — adds Shopify, Twilio, Slack signature verification requirements; broadens *Provider secrets are used as literal key material* to include all five providers. The verified OUTCOME (a real Shopify/Twilio/Slack-signed request is accepted, a forged or stale one is rejected with the correct `PostelError`) is CONTRACT; the TypeScript factory names/shapes are the port mechanism, same as wave 1.

## Wire-format / DB-schema impact

None. Inbound verification of third-party-signed requests; no change to Postel's own produced wire format or DB schema.

## Impact

- `@postel/core`: new public exports `Shopify`, `Twilio`, `Slack` (strategies), same `internal/` primitives as wave 1 plus HMAC-SHA1 (Twilio's scheme mandates it) via the same `crypto.subtle` HMAC primitive, parameterized by hash name.
- Docs: `docs/content/docs/inbound/verify.mdx` provider matrix gains three rows.
- Tests: `typescript/packages/core/test/provider-verifiers.test.ts`.
