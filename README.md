# Postel

> Be conservative in what you send, liberal in what you accept.
> — Jon Postel, RFC 793

**Postel is an embeddable webhook delivery library for TypeScript.**

It runs inside your application, against your existing Postgres or SQLite database, with no separate service to deploy. [Standard Webhooks](https://www.standardwebhooks.com/) compliant, sender + receiver, opinionated defaults, programmable in code rather than configured by DSL.

## Status

Pre-alpha. Specification stage. The full design is in [SPECIFICATION.md](./SPECIFICATION.md).

## Positioning

> **Svix is for when webhooks are your product.
> Postel is for when webhooks are a feature of your product.**

Postel does not compete with Svix or Hookdeck on customer-facing webhook portals, multi-region delivery, or 99.999% uptime SLAs. It targets a different audience: teams who want to add reliable outbound webhooks to an existing application without standing up a separate service, and teams whose runtimes (Cloudflare Workers, Vercel Edge, Deno Deploy, Bun, single-binary OSS products) cannot run a Postgres + Redis + service sidecar in the first place.

## What it provides

- **Outbound delivery**: persistent outbox transacted with your database, retry with jitter, per-endpoint circuit breaker, dead-letter, replay-as-a-verb
- **Inbound verification**: framework middleware that preserves raw bytes, multi-secret rotation window, JWKS consumer, structured verifier errors
- **Key management**: HMAC-SHA256 and Ed25519, rotation with overlap windows, JWKS endpoint mounter, optional ephemeral keys
- **Standard Webhooks compliant** out of the box; wraps the official signing libraries rather than reinventing crypto
- **Edge-runtime native**: sub-50KB receiver bundle, Web Crypto only, runs unmodified on Cloudflare Workers, Vercel Edge, Deno Deploy, Bun
- **No new infrastructure**: Postgres or SQLite — no Redis, no message queue, no separate process

## Architecture identity

Postel is a **library, not a service.** It will never have a hosted offering, never run a separate dispatcher process, never require Redis or a message broker, never ship a customer-facing portal as a packaged product. If you need any of that, use Svix or Hookdeck Outpost.

## Specification

See [SPECIFICATION.md](./SPECIFICATION.md) for the full cahier des charges: scope, functional and non-functional requirements, storage layer, API design principles, packaging, quality bars, and explicit out-of-scope items.

## Inspiration

Named after [Jon Postel](https://en.wikipedia.org/wiki/Jon_Postel), whose [Robustness Principle](https://en.wikipedia.org/wiki/Robustness_principle) (RFC 793, 1981) — *"be conservative in what you do, be liberal in what you accept from others"* — is the design philosophy this library embodies. Strict signing, deterministic timestamps, careful retry budgets on the way out; multi-secret tolerance, raw-bytes preservation, JWKS-based key discovery, helpful verifier errors on the way in.

## License

To be determined before 1.0 (MIT or Apache-2.0).
