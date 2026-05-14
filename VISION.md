# Postel — Vision

**Status:** v0 draft, pre-implementation.
**Audience:** maintainers, contributors, reviewers, future selves, port authors.

> **Postel is a polyglot webhooks library backed by solid, executable specs. The TypeScript implementation in this repo ships first; Go, Python, and Rust follow. Every port conforms to the same wire format, DB schema, and capability behaviors — verified end-to-end by the [@postel/compliance](compliance/README.md) test suite.**

---

## 1. Problem

Teams whose product ships outbound webhooks today choose between:

- **Services like Svix or Hookdeck Outpost** — operational footprint (Postgres + Redis + a separate dispatcher process), $0→$490/mo cliff for hosted, cannot run on edge runtimes at all.
- **Hand-rolled on Sidekiq / Oban / BullMQ** — the queue handles retries; everything else (signing, idempotency, replay, key rotation, JWKS, multi-secret window, dedup, raw-bytes preservation) is reimplemented every time.

The [Standard Webhooks](https://www.standardwebhooks.com/) specification covers the wire format and ships signing helpers in nine languages, but explicitly leaves delivery, retry, key management, replay, and operational tooling to implementers.

## 2. What Postel is

An embeddable, **library-only** kernel for outbound and inbound webhooks that runs inside the host application against the host application's database. Standard Webhooks-compliant, sender + receiver, opinionated defaults, programmable in code rather than configured by DSL.

Postel writes through the host's existing database access layer — whether that's raw Postgres / SQLite, a query builder like Kysely, or an ORM like Drizzle or Prisma. Outbox inserts participate in the host's transaction, so `send()` commits or rolls back atomically with the host's business writes — the transactional-outbox guarantee without extra connections, brokers, or a sidecar process. The full strategy is in [decisions/0007-storage-strategy.md](decisions/0007-storage-strategy.md).

Postel ships in multiple languages over time — TypeScript first, then Go, Python, and Rust. Every implementation conforms to the same shared specification — wire format ([AsyncAPI](specs/wire-format/asyncapi.yaml)), DB schema ([SQL DDL](specs/db-schema/0001_init.sql)), and capability behaviors ([per-capability specs](openspec/specs/)) — and is verified by the [executable compliance test suite](compliance/README.md).

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
- **Storage adapter matrix**: standalone / client / ORM adapters for Postgres and SQLite (the canonical first-class databases), with host-transaction passthrough as the outbox-pattern enabler. Other relational backends (libSQL, Turso, D1, Cockroach, PlanetScale, …) connect via the same `Storage` interface contract
- Endpoint and key management primitives (programmatic only)
- Admin HTTP handlers (mounted on the host's router) for ops dashboards
- TypeScript implementation across Node, Bun, Deno, and edge runtimes (ships first)
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
6. Does the TypeScript implementation pass `@postel/compliance` end-to-end?
7. Are the receiver verifier errors actionable (which step failed and why)?
8. Does the multi-tenant scheduler isolate noisy neighbors by default?
9. Is the "Why not a service?" answer obvious from the docs?
10. Are the wire format (AsyncAPI), DB schema (SQL), and capability specs documented well enough that the first community port (Go receiver) is plausible — and validated by passing the compliance suite?

If all yes → 1.0. Otherwise it's not done.

## 8. Conformance & versioning policy

Postel's cross-port contract is intentionally narrow. Two distinctions matter:

### Conformance levels

Every capability-spec requirement is either:

- **CONTRACT** — part of the cross-port contract. Every port must satisfy it; `@postel/compliance` tests it. Examples: wire-format headers, signature schemes, endpoint state vocabulary, outbox transactional semantics, dedup atomicity, the `Storage` interface operation set.
- **PORT-SPECIFIC** — reference-implementation guidance; ports MAY vary the mechanism as long as the related CONTRACT outcomes hold. Examples: worker scheduler algorithm, lease renewal cadence, polling interval default, concurrency model, HTTP client choice, memory and cache strategies.

The compliance test suite (`@postel/compliance`) is the **executable boundary** between the two. What the suite tests is CONTRACT; what it doesn't is PORT-SPECIFIC, regardless of how prose phrases it. See [ADR 0008](decisions/0008-conformance-levels.md) for the full distinction and worked examples.

### Versioning

- **Pre-1.0 (the `0.x` line) is experimental semantics.** Breaking changes are explicitly allowed across `0.x` minor versions; consumers SHOULD pin to a specific minor (e.g., `~0.5.0`), not a `^0.x` range. The OpenSpec change history is the canonical record of what changed and when.
- **From 1.0 onward**, all `@postel/*` packages follow strict SemVer: no breaking changes in minor or patch releases. All `@postel/*` packages share a major version and release together.
- **DB schema migrations are forward-only** and gated by `_postel_meta.schema_version`. Pre-1.0 migrations may be semantically breaking; post-1.0, the library reads state written by the previous two majors.
- **Wire format changes** are the most expensive layer to change because receivers in the wild verify against signature schemes. We anchor to Standard Webhooks for cover; deviations require multi-secret rotation windows and the `webhook-spec-version` header for backward compatibility.
- **Compliance suite versioning is lockstep with the `@postel/*` release train.** `@postel/compliance` shares `MAJOR.MINOR` with every other `@postel/*` package; a port version `X.Y.Z` claims conformance by passing `@postel/compliance@X.Y.*` end-to-end before release. New tests are required at the version they ship in; breaking modifications and removals go via MAJOR. The runway-versioned evolution model sketched in [ADR 0009](decisions/0009-compliance-suite-evolution.md) is **Deferred** — it becomes operationally valuable once a second independently-maintained port lands. See [`openspec/specs/compliance/spec.md`](openspec/specs/compliance/spec.md) for the testable CONTRACT scenarios.

The combination of these distinctions — narrow CONTRACT-level surface + explicit `0.x` experimental phase + lockstep release coordination across `@postel/*` packages — is the project's hedge against premature standardization. The architecture preserves the ability to learn operationally without locking ports into yesterday's decisions; the runway-versioned model in [ADR 0009](decisions/0009-compliance-suite-evolution.md) is the planned successor once multi-port maintainer cadences make lockstep insufficient.
