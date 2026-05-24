<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/public/brand/postel-mark-dark.svg">
    <img alt="Postel" src="./docs/public/brand/postel-mark-light.svg" width="96" height="96">
  </picture>
</p>

<h1 align="center">Postel</h1>

<p align="center">
  <em>Be conservative in what you send, liberal in what you accept.</em><br>
  — Jon Postel, RFC 793
</p>

**Sending and receiving webhooks is easy. Doing it reliably and securely is hard** — retries, replay, signing, key rotation, idempotency, raw-bytes preservation. That's where Postel comes in: a polyglot library that handles those for you. The TypeScript implementation ships first; Go, Python, and Rust follow. Every port conforms to the same wire format, DB schema, and capability behaviors — verified end-to-end by the [@postel/compliance](compliance/README.md) test suite.

[Standard Webhooks](https://www.standardwebhooks.com/) compliant, sender + receiver, runs inside your application against your existing relational database (Postgres, MySQL, SQLite, …) — no separate service, no Redis, no message broker.

## Status

Pre-alpha. Specification stage. See [`VISION.md`](./VISION.md) for the top-level positioning, scope, and success criteria. Detailed specs live under [`openspec/specs/`](./openspec/specs/) and [`specs/`](./specs/).

## Positioning

> **Svix is for when webhooks are your product.
> Postel is for when webhooks are a feature of your product.**

Postel does not compete with Svix or Hookdeck on customer-facing webhook portals, multi-region delivery, or 99.999% uptime SLAs. It targets a different audience: teams who want to add reliable outbound webhooks to an existing application without standing up a separate service, and single-binary OSS products that cannot run a Postgres + Redis + service sidecar in the first place.

Postel is a **library, not a service**. It will never have a hosted offering, never run a separate dispatcher process, never require Redis or a message broker, never ship a customer-facing portal as a packaged product. If you need any of that, use Svix or Hookdeck Outpost.

## Specs (sources of truth)

| Layer | Source of truth | Format |
|---|---|---|
| Top-level positioning, scope, success criteria | [`VISION.md`](./VISION.md) | Markdown |
| Wire format | [`specs/wire-format/asyncapi.yaml`](./specs/wire-format/asyncapi.yaml) | AsyncAPI 3.0 |
| DB schema | [`specs/db-schema/0001_init.sql`](./specs/db-schema/0001_init.sql) | SQL DDL |
| Capability behaviors | [`openspec/specs/`](./openspec/specs/) | Markdown (per capability) |
| Architectural decisions | [`decisions/`](./decisions/) | Markdown ADRs |
| Behavioral oracle | `@postel/compliance` (planned) | Executable test suite |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the repository layout, dev environment setup ([mise](https://mise.jdx.dev)-based), the OpenSpec change workflow, the verification chain, and house conventions. Agentic tools (Claude Code, Codex, Cursor, Aider, Gemini, …) should also read [AGENTS.md](./AGENTS.md).

## Inspiration

Named after [Jon Postel](https://en.wikipedia.org/wiki/Jon_Postel), whose [Robustness Principle](https://en.wikipedia.org/wiki/Robustness_principle) (RFC 793, 1981) — *"be conservative in what you do, be liberal in what you accept from others"* — is the design philosophy this library embodies. Strict signing, deterministic timestamps, careful retry budgets on the way out; multi-secret tolerance, raw-bytes preservation, JWKS-based key discovery, helpful verifier errors on the way in.

## License

To be determined before 1.0 (MIT or Apache-2.0).
