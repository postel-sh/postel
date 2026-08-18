## ADDED Requirements

### Requirement: Stripe signature verification

The library SHALL provide a `Stripe(secret: string, options?: { toleranceSeconds?: number; clock?: Clock })` `Verifier` factory that verifies inbound requests against Stripe's `Stripe-Signature` header scheme: comma-separated `key=value` pairs carrying a Unix timestamp (`t`) and one or more HMAC-SHA256 hex signatures (`v1`), each computed over the canonical string `${t}.${rawBody}`. The secret SHALL be used as literal UTF-8 key material with no transformation (see *Provider secrets are used as literal key material*). Verification SHALL succeed if ANY `v1` tuple matches. The timestamp SHALL be enforced against a tolerance window, default 300 seconds, using the same injectable-clock mechanism `VerifyOptions.clock` already provides elsewhere in the receiver capability. On success, the returned event's `type` and `data` SHALL come from the request body's own `type` and `data` fields (Stripe's event envelope already carries both).

#### Scenario: Valid Stripe signature is accepted

- **WHEN** a request carries a `Stripe-Signature` header whose `v1` value is a correct HMAC-SHA256 of `${t}.${rawBody}` under the configured secret, within the tolerance window
- **THEN** `Stripe(secret).verify(...)` resolves with the parsed event, `type` and `data` matching the request body

#### Scenario: Wrong secret is rejected

- **WHEN** a request's `Stripe-Signature` was computed with a different secret than the one configured
- **THEN** `Stripe(secret).verify(...)` rejects with `SignatureInvalid`

#### Scenario: Stale timestamp is rejected

- **WHEN** the `t` value in `Stripe-Signature` is older than the tolerance window (default 300 seconds)
- **THEN** `Stripe(secret).verify(...)` rejects with `TimestampTooOld`, even when the `v1` signature itself is correct

#### Scenario: Missing Stripe-Signature header is rejected

- **WHEN** a request has no `Stripe-Signature` header at all
- **THEN** `Stripe(secret).verify(...)` rejects with `MalformedHeader`

#### Scenario: Malformed Stripe-Signature header is rejected

- **WHEN** the `Stripe-Signature` header has no `t=` component or no `v1=` component
- **THEN** `Stripe(secret).verify(...)` rejects with `MalformedHeader`

#### Scenario: Multiple v1 tuples, any match accepted

- **WHEN** `Stripe-Signature` carries more than one `v1` value (as Stripe's own docs say may happen) and at least one matches
- **THEN** `Stripe(secret).verify(...)` resolves successfully

### Requirement: GitHub signature verification

The library SHALL provide a `GitHub(secret: string)` `Verifier` factory that verifies inbound requests against GitHub's `X-Hub-Signature-256` header scheme: a `sha256=<hex>` value computed as HMAC-SHA256 over the raw request body. The secret SHALL be used as literal UTF-8 key material with no transformation (see *Provider secrets are used as literal key material*). GitHub sends no timestamp header on webhook deliveries, so this verifier SHALL NOT enforce any timestamp or replay window — that is an intentional scope limit of the provider's own scheme, not a gap. The event's `type` SHALL come from the `X-GitHub-Event` header (GitHub's payload body carries no `type` field of its own); `data` SHALL be the entire parsed request body.

#### Scenario: Valid GitHub signature is accepted

- **WHEN** a request carries `X-Hub-Signature-256: sha256=<hex>` that is a correct HMAC-SHA256 of the raw body under the configured secret, and an `X-GitHub-Event` header
- **THEN** `GitHub(secret).verify(...)` resolves with the parsed event, `type` equal to the `X-GitHub-Event` header value and `data` equal to the parsed body

#### Scenario: Wrong secret is rejected

- **WHEN** a request's `X-Hub-Signature-256` was computed with a different secret than the one configured
- **THEN** `GitHub(secret).verify(...)` rejects with `SignatureInvalid`

#### Scenario: Missing X-Hub-Signature-256 header is rejected

- **WHEN** a request has no `X-Hub-Signature-256` header at all
- **THEN** `GitHub(secret).verify(...)` rejects with `MalformedHeader`

#### Scenario: Malformed X-Hub-Signature-256 header is rejected

- **WHEN** the `X-Hub-Signature-256` header value has no `sha256=` prefix
- **THEN** `GitHub(secret).verify(...)` rejects with `MalformedHeader`

#### Scenario: Missing X-GitHub-Event header is rejected

- **WHEN** a request has a valid `X-Hub-Signature-256` but no `X-GitHub-Event` header
- **THEN** `GitHub(secret).verify(...)` rejects with `MalformedHeader`

#### Scenario: No timestamp window is enforced

- **WHEN** a validly-signed GitHub request is verified regardless of how old its delivery is (GitHub sends no timestamp to check)
- **THEN** `GitHub(secret).verify(...)` resolves successfully purely on signature match, with no `TimestampTooOld` possible

### Requirement: Provider secrets are used as literal key material

`Stripe` and `GitHub` SHALL treat their `secret` argument as an opaque, literal UTF-8-encoded string used directly as HMAC key material. This is a DIFFERENT convention than `Secret`/`PublicKey`'s Standard Webhooks secret handling (`whsec_`-prefix-stripped-then-base64-decoded): a real Stripe signing secret is itself formatted like `whsec_...`, but per Stripe's own signing scheme the entire string, prefix included, is the literal key — it is not base64 inside. `Stripe`/`GitHub` MUST NOT route their secret through the Standard Webhooks secret-decoding convention.

#### Scenario: A Stripe-shaped secret is used verbatim, prefix included

- **WHEN** `Stripe("whsec_test_1234")` verifies a request signed with HMAC-SHA256 keyed on the literal UTF-8 bytes of `"whsec_test_1234"`
- **THEN** verification succeeds
- **AND** it would NOT succeed if the secret were instead base64-decoded per the Standard Webhooks convention first

**Conformance**: CONTRACT. The verified outcome — a genuinely Stripe/GitHub-signed request is accepted, a forged or (for Stripe) stale one is rejected with the correct `PostelError` — is the cross-port contract. The TypeScript factory names (`Stripe`, `GitHub`) and their exact option shapes are this port's mechanism; another port MAY expose the same outcome through its own idiom.
