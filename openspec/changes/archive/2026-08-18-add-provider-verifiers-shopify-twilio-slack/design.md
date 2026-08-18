# Design — Shopify, Twilio, Slack provider verifiers

## Context

Issue #137, follow-up to #136. Same `Verifier` interface, same `strategies/` home decision (see wave 1's design.md — unchanged reasoning, not repeated here). This design only settles what's new: Twilio's URL requirement and its missing event-type discriminator, and the HMAC-SHA1 primitive Twilio's scheme mandates.

## Goals / Non-Goals

**Goals**
- Correct, provider-faithful verification for all three: Shopify's `X-Shopify-Hmac-Sha256` (base64 HMAC-SHA256 over raw body), Twilio's `X-Twilio-Signature` (base64 HMAC-SHA1 over URL+sorted-params), Slack's `X-Slack-Signature` (`v0` hex HMAC-SHA256 over `v0:{timestamp}:{rawBody}`).
- Zero new runtime dependencies — HMAC-SHA1 is available from the same `crypto.subtle` primitive already used for SHA-256, just a different `hash` parameter.

**Non-Goals**
- A generic provider-verifier plugin registry (per wave 1's design.md — still true, three more concrete providers doesn't force it).
- Any change to the `Verifier` interface itself. Twilio's URL requirement is solved as a constructor argument, not a `verify()` signature change.

## Key implementation decisions

- **Shopify**: `X-Shopify-Hmac-Sha256` is base64 (not hex, unlike Stripe/GitHub), HMAC-SHA256 over the raw body. No timestamp header exists on Shopify webhook deliveries — same "no timestamp window enforced" scope limit as GitHub, not a gap. Event `type` comes from `X-Shopify-Topic` (e.g. `orders/create`); `data` is the entire parsed body, same convention as GitHub since Shopify's payload has no separate `type`/`data` envelope fields of its own.
- **Twilio**: the only provider whose signature covers more than headers+body — it's computed over the exact webhook URL Twilio POSTed to, concatenated with all POST form parameters sorted by key and appended as `key` then `value` with no delimiters, then HMAC-SHA1 keyed on the Auth Token, base64-encoded. Two consequences:
  - The verifier needs the URL as an input. Since a given `Twilio(...)` instance is wired to one specific, fixed webhook endpoint (the developer registers that exact URL with Twilio), this is a constructor argument — `Twilio(authToken: string, url: string)` — supplied once at configuration time, not derived per-request from anything `verify(rawBody, headers)` receives. This keeps the `Verifier` interface completely unchanged; no other provider needs this, so it isn't threaded through the shared interface for one case.
  - Twilio's body is `application/x-www-form-urlencoded`, not JSON, and carries no field or header analogous to Stripe's body `type`, GitHub's `X-GitHub-Event`, or Shopify's `X-Shopify-Topic`. Rather than guess at a heuristic discriminator (different Twilio webhook categories — incoming message, message status, voice status — use different, non-overlapping field names, so no single field works universally), `Twilio` reports a fixed `type: "twilio.webhook"` and surfaces every form parameter as `data`. This mirrors the receiver capability's existing `schema` option as the intended way to type/route inside a Twilio source.
  - HMAC-SHA1 is cryptographically weaker than SHA-256, but it isn't our choice — it's Twilio's own signing scheme, unchanged since Twilio's inception. Implementing anything else wouldn't interoperate with real Twilio deliveries.
- **Slack**: near-identical shape to Stripe. `X-Slack-Signature: v0=<hex>` plus a separate `X-Slack-Request-Timestamp` header (Stripe embeds `t=` in the same header; Slack splits it into two). Canonical string is `v0:${timestamp}:${rawBody}`. Default tolerance 300s (Slack's documented recommendation), using the same injectable `VerifyOptions.clock`/`toleranceSeconds` shape as Stripe. Event `type` comes from the body's own top-level `type` field (`event_callback`, `url_verification`, …); `data` is the entire parsed body (the meaningful payload for `event_callback` lives nested under `data.event`, but there's no separate top-level `data` field the way Stripe's envelope has one, so — like GitHub/Shopify — the whole body is `data`).
- **Provider secrets are used as literal key material** (wave 1 requirement) is broadened, not duplicated: `Shopify`/`Twilio`/`Slack` secrets are equally literal, opaque, UTF-8 key material with no `whsec_`-style decoding.

## Risks / Trade-offs

- *Risk*: `Twilio`'s fixed `type: "twilio.webhook"` is less immediately useful than a real discriminator. *Mitigation*: documented explicitly as this provider's scope limit (no wire-level discriminator exists), same treatment wave 1 gave GitHub's missing timestamp — an intentional, spec'd limit, not a silent gap. Callers needing to branch on Twilio's own semantics already have `data` and the `schema` option for that.
- *Risk*: Twilio's `url` argument must exactly match what Twilio actually POSTed to (scheme, host, path, query string) — a reverse proxy that rewrites `X-Forwarded-Proto`/host without the app knowing can break this. *Mitigation*: this is inherent to Twilio's own scheme (Twilio's own SDKs have the identical caveat), not something Postel can paper over; called out in docs.

## Open Questions

None blocking.
