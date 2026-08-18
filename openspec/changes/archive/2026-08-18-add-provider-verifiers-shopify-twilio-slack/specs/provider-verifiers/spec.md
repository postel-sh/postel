## ADDED Requirements

### Requirement: Shopify signature verification

The library SHALL provide a `Shopify(secret: string)` `Verifier` factory that verifies inbound requests against Shopify's `X-Shopify-Hmac-Sha256` header scheme: a base64-encoded HMAC-SHA256 digest computed over the raw request body. The secret SHALL be used as literal UTF-8 key material with no transformation (see *Provider secrets are used as literal key material*). Shopify sends no timestamp header on webhook deliveries, so this verifier SHALL NOT enforce any timestamp or replay window — an intentional scope limit of the provider's own scheme, not a gap. The event's `type` SHALL come from the `X-Shopify-Topic` header (Shopify's payload body carries no `type` field of its own); `data` SHALL be the entire parsed request body.

#### Scenario: Valid Shopify signature is accepted

- **WHEN** a request carries `X-Shopify-Hmac-Sha256` that is a correct base64 HMAC-SHA256 of the raw body under the configured secret, and an `X-Shopify-Topic` header
- **THEN** `Shopify(secret).verify(...)` resolves with the parsed event, `type` equal to the `X-Shopify-Topic` header value and `data` equal to the parsed body

#### Scenario: Wrong secret is rejected

- **WHEN** a request's `X-Shopify-Hmac-Sha256` was computed with a different secret than the one configured
- **THEN** `Shopify(secret).verify(...)` rejects with `SignatureInvalid`

#### Scenario: Missing X-Shopify-Hmac-Sha256 header is rejected

- **WHEN** a request has no `X-Shopify-Hmac-Sha256` header at all
- **THEN** `Shopify(secret).verify(...)` rejects with `MalformedHeader`

#### Scenario: Malformed X-Shopify-Hmac-Sha256 header is rejected

- **WHEN** the `X-Shopify-Hmac-Sha256` header value is not valid base64
- **THEN** `Shopify(secret).verify(...)` rejects with `MalformedHeader`

#### Scenario: Missing X-Shopify-Topic header is rejected

- **WHEN** a request has a valid `X-Shopify-Hmac-Sha256` but no `X-Shopify-Topic` header
- **THEN** `Shopify(secret).verify(...)` rejects with `MalformedHeader`

#### Scenario: No timestamp window is enforced

- **WHEN** a validly-signed Shopify request is verified regardless of how old its delivery is (Shopify sends no timestamp to check)
- **THEN** `Shopify(secret).verify(...)` resolves successfully purely on signature match, with no `TimestampTooOld` possible

### Requirement: Twilio signature verification

The library SHALL provide a `Twilio(authToken: string, url: string)` `Verifier` factory that verifies inbound requests against Twilio's `X-Twilio-Signature` header scheme: a base64-encoded HMAC-SHA1 digest computed over the canonical string formed by appending, to the exact webhook `url` supplied at construction, every POST form parameter from the `application/x-www-form-urlencoded` request body — parameters sorted by key (ordinal comparison), each appended as `key` immediately followed by `value` with no delimiters. The `authToken` SHALL be used as literal UTF-8 key material with no transformation (see *Provider secrets are used as literal key material*). Twilio sends no timestamp header and its signature scheme carries no time component, so this verifier SHALL NOT enforce any timestamp or replay window — an intentional scope limit of the provider's own scheme, not a gap. Twilio's wire format carries no field or header identifying an event type, unlike Stripe/Shopify/Slack (body/header-carried `type`) or GitHub (`X-GitHub-Event`); the returned event's `type` SHALL be the fixed literal `"twilio.webhook"`, and `data` SHALL be an object of the parsed form parameters (each value a string; repeated keys collapse to the last occurrence).

#### Scenario: Valid Twilio signature is accepted

- **WHEN** a request carries `X-Twilio-Signature` that is a correct base64 HMAC-SHA1, keyed on the configured `authToken`, of the configured `url` with all POST form parameters sorted by key and appended key-then-value with no delimiters
- **THEN** `Twilio(authToken, url).verify(...)` resolves with the parsed event, `type` equal to `"twilio.webhook"` and `data` containing the request's form parameters

#### Scenario: Wrong secret is rejected

- **WHEN** a request's `X-Twilio-Signature` was computed with a different Auth Token than the one configured
- **THEN** `Twilio(authToken, url).verify(...)` rejects with `SignatureInvalid`

#### Scenario: Wrong URL is rejected

- **WHEN** a request's `X-Twilio-Signature` was computed against a different URL than the one configured at construction
- **THEN** `Twilio(authToken, url).verify(...)` rejects with `SignatureInvalid`

#### Scenario: Missing X-Twilio-Signature header is rejected

- **WHEN** a request has no `X-Twilio-Signature` header at all
- **THEN** `Twilio(authToken, url).verify(...)` rejects with `MalformedHeader`

#### Scenario: No timestamp window is enforced

- **WHEN** a validly-signed Twilio request is verified regardless of how old its delivery is (Twilio sends no timestamp and its scheme has no time component)
- **THEN** `Twilio(authToken, url).verify(...)` resolves successfully purely on signature match, with no `TimestampTooOld` possible

### Requirement: Slack signature verification

The library SHALL provide a `Slack(signingSecret: string, options?: { toleranceSeconds?: number; clock?: Clock })` `Verifier` factory that verifies inbound requests against Slack's `X-Slack-Signature` header scheme: a hex HMAC-SHA256 digest, prefixed `v0=`, computed over the canonical string `v0:${timestamp}:${rawBody}`, where `${timestamp}` is the value of the separate `X-Slack-Request-Timestamp` header. The `signingSecret` SHALL be used as literal UTF-8 key material with no transformation (see *Provider secrets are used as literal key material*). The timestamp SHALL be enforced against a tolerance window, default 300 seconds, using the same injectable-clock mechanism `VerifyOptions.clock` already provides elsewhere in the receiver capability. On success, the returned event's `type` SHALL come from the request body's own top-level `type` field; `data` SHALL be the entire parsed request body.

#### Scenario: Valid Slack signature is accepted

- **WHEN** a request carries `X-Slack-Signature: v0=<hex>` that is a correct HMAC-SHA256 of `v0:${timestamp}:${rawBody}` under the configured signing secret, with `X-Slack-Request-Timestamp` within the tolerance window
- **THEN** `Slack(signingSecret).verify(...)` resolves with the parsed event, `type` and `data` matching the request body

#### Scenario: Wrong secret is rejected

- **WHEN** a request's `X-Slack-Signature` was computed with a different signing secret than the one configured
- **THEN** `Slack(signingSecret).verify(...)` rejects with `SignatureInvalid`

#### Scenario: Stale timestamp is rejected

- **WHEN** the `X-Slack-Request-Timestamp` value is older than the tolerance window (default 300 seconds)
- **THEN** `Slack(signingSecret).verify(...)` rejects with `TimestampTooOld`, even when the signature itself is correct

#### Scenario: Missing X-Slack-Signature header is rejected

- **WHEN** a request has no `X-Slack-Signature` header at all
- **THEN** `Slack(signingSecret).verify(...)` rejects with `MalformedHeader`

#### Scenario: Missing X-Slack-Request-Timestamp header is rejected

- **WHEN** a request has a valid `X-Slack-Signature` but no `X-Slack-Request-Timestamp` header
- **THEN** `Slack(signingSecret).verify(...)` rejects with `MalformedHeader`

#### Scenario: Malformed X-Slack-Signature header is rejected

- **WHEN** the `X-Slack-Signature` header has no `v0=` prefix
- **THEN** `Slack(signingSecret).verify(...)` rejects with `MalformedHeader`

## MODIFIED Requirements

### Requirement: Provider secrets are used as literal key material

`Stripe`, `GitHub`, `Shopify`, `Twilio`, and `Slack` SHALL treat their secret argument (`secret`, `authToken`, or `signingSecret`) as an opaque, literal UTF-8-encoded string used directly as HMAC key material. This is a DIFFERENT convention than `Secret`/`PublicKey`'s Standard Webhooks secret handling (`whsec_`-prefix-stripped-then-base64-decoded): a real Stripe signing secret is itself formatted like `whsec_...`, but per Stripe's own signing scheme the entire string, prefix included, is the literal key — it is not base64 inside. None of these five factories MUST route their secret through the Standard Webhooks secret-decoding convention.

#### Scenario: A Stripe-shaped secret is used verbatim, prefix included

- **WHEN** `Stripe("whsec_test_1234")` verifies a request signed with HMAC-SHA256 keyed on the literal UTF-8 bytes of `"whsec_test_1234"`
- **THEN** verification succeeds
- **AND** it would NOT succeed if the secret were instead base64-decoded per the Standard Webhooks convention first

**Conformance**: CONTRACT. The verified outcome — a genuinely Stripe/GitHub/Shopify/Twilio/Slack-signed request is accepted, a forged or (for Stripe/Slack) stale one is rejected with the correct `PostelError` — is the cross-port contract. The TypeScript factory names (`Stripe`, `GitHub`, `Shopify`, `Twilio`, `Slack`) and their exact option shapes are this port's mechanism; another port MAY expose the same outcome through its own idiom.
