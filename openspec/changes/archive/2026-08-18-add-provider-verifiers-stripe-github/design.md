# Design — Stripe and GitHub provider verifiers

## Context

Issue #136: adopters receiving from Stripe or GitHub must hand-write a custom `Verifier` today. The `Verifier` interface (`verify(rawBody, headers, options?): Promise<VerifyResult>`) already exists as an open contract in `@postel/core` (`strategies/verify.ts`), and `Secret`/`PublicKey`/`Keyset`/`Noop` already live there as built-in factories implementing it. The question this design settles: does `Stripe`/`GitHub` get a new `@postel/verifiers` package, or land in `@postel/core` alongside the existing factories?

## Goals / Non-Goals

**Goals**
- Correct, provider-faithful verification: Stripe's `t=`/`v1=` scheme with its own tolerance/rotation behavior; GitHub's `sha256=` scheme with no timestamp concept at all.
- Zero new runtime dependencies.
- Reuse existing internal crypto/header primitives rather than re-implementing them.

**Non-Goals**
- Shopify, Twilio, Slack (#137).
- A generic "provider verifier SDK" or plugin registry — just two concrete factories, per YAGNI. Add abstraction when a third provider's shape actually forces it.

## Decision

**Home = `@postel/core`, alongside `Secret`/`PublicKey`/`Keyset`/`Noop` in `strategies/`, not a new `@postel/verifiers` package.**

This is the opposite conclusion from [ADR 0017](../../../decisions/0017-framework-adapter-pattern.md) (HTTP gating got its own `@postel/http` package) and consistent with [ADR 0012](../../../decisions/0012-package-granularity.md) (core stays unified; tree-shaking substitutes for package-level splitting). The deciding factor is *why* those other splits happened:

- Storage adapters and framework adapters each pull in a genuinely new runtime dependency (`pg`, `mysql2`, `drizzle-orm`, `express`, `fastify`, …) that would bloat `@postel/core`'s own install footprint for adopters who use neither. `@postel/http` also needed a home for a genuinely different concern (HTTP gating) that core didn't already have logic for.
- `Stripe`/`GitHub` need **zero new dependencies**. Both are plain HMAC-SHA256 over the raw body, computed with `crypto.subtle` — the exact primitive `internal/hmac.ts` already wraps for the Standard Webhooks `v1` scheme. Constant-time comparison reuses `internal/timing.ts`'s `constantTimeEqual`, unused elsewhere in the codebase today. Header reading reuses `internal/headers.ts`'s case-insensitive `readHeader`/`requireHeader`. None of this is public API surface — it's already sitting right there as internal core code, and putting `Stripe`/`GitHub` in a separate package would force either duplicating these ~30 lines or exporting them from core's public surface just so an external package could reach them (the exact tax `@postel/http` paid: it had to hand-roll a 6-line header reader rather than reuse core's internal one, per its own design doc).
- Tree-shaking (ADR 0012's point 4) already means an adopter who imports only `Secret` doesn't pay for `Stripe`/`GitHub` in their bundle, and vice versa. There's no bundle-budget case here the way there could theoretically be for, say, storage adapters.
- `Stripe`/`GitHub` implement the exact same `Verifier` interface Secret/PublicKey/Keyset do and compose through the exact same array/map loop — this is additive to an existing, already-core-resident concern, not a new one.

If a third or fourth provider (#137: Shopify, Twilio, Slack) turns out to need a real external dependency (unlikely — all major webhook providers use plain HMAC) or the catalog grows large enough that core's install size becomes a real complaint, this is revisited then. Until a concrete cost shows up, splitting is premature.

## Key implementation decisions

- **Provider secrets are raw, opaque strings — NOT run through `internal/secret.ts`'s `decodeSecret`.** Standard Webhooks secrets use a `whsec_`-prefix-then-base64-decode convention specific to that spec. Stripe's own secrets *also* happen to look like `whsec_...`, but per Stripe's docs the entire string (prefix included) is used as literal UTF-8 HMAC key material — it is not base64 inside. Reusing `decodeSecret` here would silently corrupt the key for most real Stripe secrets. `Stripe`/`GitHub` take the secret as a plain string, UTF-8 encoded directly.
- **Stripe**: `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>...]`. Canonical signed string is `${t}.${rawBody}`. Any `v1` tuple matching counts as a match (Stripe's own docs note more than one `v1` value can appear). Default tolerance 300s (Stripe's documented default), configurable via the same `{ toleranceSeconds?, clock? }` shape `VerifyOptions` already uses.
- **GitHub**: `X-Hub-Signature-256: sha256=<hex>`. Canonical signed bytes are the raw body only — GitHub sends no timestamp header at all, so there is no tolerance/replay window to enforce at this layer (documented explicitly as a scenario, not a silent gap). Event `type` is not in the body; it comes from the `X-GitHub-Event` header.
- **Event mapping** does not reuse core's `parseEvent` (which requires the body itself to contain a `type` string field — true for Stripe's envelope, false for GitHub's). Each provider builds its own `WebhookEvent` after signature verification succeeds.

## Risks / Trade-offs

- *Risk*: growing `strategies/` with more per-provider files could eventually make `@postel/core` feel like a dumping ground. *Mitigation*: the bar stays "zero new dependency, same `Verifier` interface" — the moment that bar isn't met, split then (see Decision above).
- *Risk*: someone "fixes" `Stripe`'s secret handling to go through `decodeSecret` for consistency with `Secret()`, silently breaking real Stripe secrets. *Mitigation*: called out explicitly as its own spec requirement + test, not just a code comment.

## Open Questions

None blocking.
