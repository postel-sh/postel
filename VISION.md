# Postel — Vision

**Status:** v0 draft, pre-implementation.
**Audience:** maintainers, contributors, reviewers, future selves, port authors.

> **Postel is a spec-first webhooks library. The TypeScript implementation in this repo is the reference implementation. Additional language ports (Go, Python, Rust, …) are first-class roadmap items, gated on passing the [@postel/compliance](specs/compliance/README.md) test suite.**

---

## 1. Problem

Teams whose product ships outbound webhooks today choose between:

- **Services like Svix or Hookdeck Outpost** — operational footprint (Postgres + Redis + a separate dispatcher process), $0→$490/mo cliff for hosted, cannot run on edge runtimes at all.
- **Hand-rolled on Sidekiq / Oban / BullMQ** — the queue handles retries; everything else (signing, idempotency, replay, key rotation, JWKS, multi-secret window, dedup, raw-bytes preservation) is reimplemented every time.

The [Standard Webhooks](https://www.standardwebhooks.com/) specification covers the wire format and ships signing helpers in nine languages, but explicitly leaves delivery, retry, key management, replay, and operational tooling to implementers.

## 2. What Postel is

An embeddable, **library-only** kernel for outbound and inbound webhooks that runs inside the host application against the host application's database. Standard Webhooks-compliant, sender + receiver, opinionated defaults, programmable in code rather than configured by DSL.

The **specs** in this repo (wire format, DB schema, capability behaviors, compliance suite) are the source of truth. Each language implementation — starting with TypeScript — must pass the same compliance suite to be considered conformant.

### Positioning

> **Svix is for when webhooks are your product. Postel is for when webhooks are a feature of your product.**

### Source of truth

- **Wire format**: [`specs/wire-format/asyncapi.yaml`](specs/wire-format/asyncapi.yaml) (AsyncAPI 3.0)
- **DB schema**: [`specs/db-schema/0001_init.sql`](specs/db-schema/0001_init.sql) (canonical SQL DDL)
- **Capability behaviors**: [`openspec/specs/<capability>/spec.md`](openspec/specs/) (one folder per capability)
- **Decisions**: [`decisions/`](decisions/) (markdown ADRs)
- **Behavioral oracle**: `@postel/compliance` (the test suite a port must pass)

## 3. Personas

| Persona | Stack | What they need |
|---|---|---|
| Backend engineer at a B2B SaaS | Node/TS or Bun on Postgres | "Add webhooks to our product without standing up another service or paying $490/mo" |
| Edge/serverless engineer | Cloudflare Workers, Vercel Edge, Deno Deploy | "Sign and dispatch from the edge; verify in <50KB; no Postgres+Redis" |
| OSS product maintainer | Plausible-, Pocketbase-, Cal.com-style single-binary | "Ship webhooks as a built-in feature with zero infra dependencies" |
| Webhook receiver developer | Any TS framework | "Verify signatures correctly the first time; never get burned by raw-bytes/JSON re-serialization" |
| Effect-TS user | Effect-based stack | "First-class `Effect` adapter, not just a callback API bolted on" |
| Port author (Go, Python, Rust, …) | Any | "Specs that are clear and stable enough to implement against, with an executable suite that says when I'm done" |

## 4. Scope

### In scope

- Outbound (sender) delivery: persistence, retry, signing, key rotation, replay, dead-letter, circuit breaker, filtering, transformation
- Inbound (receiver) verification: middleware adapters, raw-bytes preservation, idempotency dedup, JWKS consumer
- Endpoint and key management primitives (programmatic only)
- Admin HTTP handlers (mounted on the host's router) for ops dashboards
- TypeScript reference implementation across Node, Bun, Deno, and edge runtimes
- OpenTelemetry instrumentation
- A vendor-neutral compliance test suite for Standard Webhooks
- **Polyglot port roadmap**: language ports (Go receiver next, then Python, then Rust) are first-class. Each port is added via an OpenSpec change with a `language-impact.md` artifact and is gated on passing `@postel/compliance`.

### Non-goals

Postel will never:

- Be a service or host one
- Run a separate dispatcher process
- Require Redis, RabbitMQ, Kafka, or any message broker
- Ship a customer-facing portal as a packaged product
- Compete on multi-region replication or five-nines SLAs

If any of those are required, Svix or Hookdeck Outpost is the right tool.

### Adjacent (separate artifacts in the same monorepo, optional install)

- Compliance test suite (CLI binary you point at any Standard Webhooks producer)
- Debug proxy (CLI that intercepts incoming webhooks and explains signature failures)
- Migration tools for moving from Svix self-hosted, Sidekiq webhook patterns, hand-rolled outbox

## 5. Operational principles

- **OSS license**: MIT or Apache-2.0 (decided before 1.0).
- **Single-vendor friendly governance**: maintainer-led with clear contribution guidelines.
- **No "open-core"**: every feature in the capability specs ships in OSS, forever.
- **Standard Webhooks consortium engagement**: pursue official "delivery layer" reference implementation status.
- **Public roadmap.**
- **Funding model**: separate concern (sponsorships, support contracts) — never feature-gating.

## 6. Adoption goals

- Docs site with: quickstart per framework, conceptual guides (idempotency, retries, replay, key rotation), full API reference, runnable examples.
- Migration guides: from Svix self-hosted, from raw Sidekiq/BullMQ worker patterns, from hand-rolled outbox, from Standard Webhooks signing-only libs.
- Reference applications: a "minimal SaaS that sends and receives webhooks" for Next.js, Express, Hono, plus a Cloudflare Worker example.
- Recipe cookbook: ephemeral keys with JWKS, multi-tenant isolation, replay UI, dead-letter alerting, OpenTelemetry integration.
- "Why not a service?" essay on the docs site to set expectations.
- Public benchmark page (deliveries/sec, latency percentiles).
- Spec extension proposals (versioning, JWKS, IETF alignment) submitted to Standard Webhooks repo, with this lib as reference implementation.

## 7. Definition of done for 1.0

A reasonable observer can answer YES to all of:

1. Does the receiver lib run unmodified on Cloudflare Workers in ≤ 50 KB?
2. Can I add webhooks to my Postgres-backed app without bringing up Redis or a service?
3. Does it handle key rotation with overlap windows out of the box?
4. Can I publish a JWKS endpoint with one line?
5. Is replay a first-class API verb, not bolted on?
6. Does the TS reference implementation pass `@postel/compliance` end-to-end?
7. Are the receiver verifier errors actionable (which step failed and why)?
8. Does the multi-tenant scheduler isolate noisy neighbors by default?
9. Is the "Why not a service?" answer obvious from the docs?
10. Are the wire format (AsyncAPI), DB schema (SQL), and capability specs documented well enough that the first community port (Go receiver) is plausible — and validated by passing the compliance suite?

If all yes → 1.0. Otherwise it's not done.
