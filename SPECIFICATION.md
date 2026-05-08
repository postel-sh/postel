# Postel — Specification (Cahier des Charges)

**Status:** v0 draft, pre-implementation.
**Audience:** maintainers, contributors, reviewers, future selves.
**Goal:** define the finished product with enough precision that a phased implementation plan can be derived directly from it. Not an MVP scope; this is the target.

---

## Table of contents

1. [Context & positioning](#1-context--positioning)
2. [Personas](#2-personas)
3. [Scope](#3-scope)
4. [Functional requirements](#4-functional-requirements)
5. [Non-functional requirements](#5-non-functional-requirements)
6. [Storage layer](#6-storage-layer)
7. [Architecture & API design principles](#7-architecture--api-design-principles)
8. [Distribution & packaging](#8-distribution--packaging)
9. [Quality, testing & tooling](#9-quality-testing--tooling)
10. [Documentation & adoption artifacts](#10-documentation--adoption-artifacts)
11. [Operational principles](#11-operational-principles)
12. [Success criteria for 1.0](#12-success-criteria-for-10)

---

## 1. Context & positioning

### 1.1 Problem

Teams whose product ships outbound webhooks today choose between:

- **Services like Svix or Hookdeck Outpost** — operational footprint (Postgres + Redis + a separate dispatcher process), $0→$490/mo cliff for hosted, cannot run on edge runtimes at all.
- **Hand-rolled on Sidekiq / Oban / BullMQ** — the queue handles retries; everything else (signing, idempotency, replay, key rotation, JWKS, multi-secret window, dedup, raw-bytes preservation) is reimplemented every time.

The [Standard Webhooks](https://www.standardwebhooks.com/) specification covers the wire format and ships signing helpers in nine languages, but explicitly leaves delivery, retry, key management, replay, and operational tooling to implementers.

### 1.2 Vision

A TypeScript-first, embeddable, **library-only** kernel for outbound and inbound webhooks that runs inside the host application against the host application's database. Standard Webhooks-compliant, sender + receiver, opinionated defaults, programmable in code rather than configured by DSL.

### 1.3 Positioning statement

> **Svix is for when webhooks are your product. Postel is for when webhooks are a feature of your product.**

### 1.4 Non-goals

Postel will never:

- Be a service or host one
- Run a separate dispatcher process
- Require Redis, RabbitMQ, Kafka, or any message broker
- Ship a customer-facing portal as a packaged product
- Compete on multi-region replication or five-nines SLAs
- Maintain ports in other languages (the spec is published; community ports are welcome but unowned)

If any of those are required, Svix or Hookdeck Outpost is the right tool.

---

## 2. Personas

| Persona | Stack | What they need |
|---|---|---|
| Backend engineer at a B2B SaaS | Node/TS or Bun on Postgres | "Add webhooks to our product without standing up another service or paying $490/mo" |
| Edge/serverless engineer | Cloudflare Workers, Vercel Edge, Deno Deploy | "Sign and dispatch from the edge; verify in <50KB; no Postgres+Redis" |
| OSS product maintainer | Plausible-, Pocketbase-, Cal.com-style single-binary | "Ship webhooks as a built-in feature with zero infra dependencies" |
| Webhook receiver developer | Any TS framework | "Verify signatures correctly the first time; never get burned by raw-bytes/JSON re-serialization" |
| Effect-TS user | Effect-based stack | "First-class `Effect` adapter, not just a callback API bolted on" |

---

## 3. Scope

### 3.1 In scope

- Outbound (sender) delivery: persistence, retry, signing, key rotation, replay, dead-letter, circuit breaker, filtering, transformation
- Inbound (receiver) verification: middleware adapters, raw-bytes preservation, idempotency dedup, JWKS consumer
- Endpoint and key management primitives (programmatic only)
- Admin HTTP handlers (mounted on the host's router) for ops dashboards
- TypeScript reference implementation across Node, Bun, Deno, and edge runtimes
- OpenTelemetry instrumentation
- A vendor-neutral compliance test suite for Standard Webhooks

### 3.2 Out of scope (explicit)

| Item | Why |
|---|---|
| Customer-facing portal as a packaged product | Crosses into Svix's territory; users build their own UI on the admin handlers |
| Separate dispatcher process / sidecar | Architectural identity is "library, not service" |
| Hosted SaaS offering | Project is OSS; no commercial entity needed |
| Multi-region replication | Defer to host DB (Postgres physical/logical replication, Litestream, etc.) |
| Non-HTTP destinations (Kafka, SQS, MQTT, S3) | Stays a webhook library; users layer their own adapters |
| Visual workflow / no-code UI | Configuration is code |
| Inbound event ingestion API ("send us your events, we route") | That's a service shape |
| Native mobile SDK | React Native / Capacitor can use the JS receiver lib |
| Cron / scheduled webhook firing | Use the host's scheduler |
| Maintained ports in Go / Python / Rust / Ruby / etc. | Wire format and DB schema are documented and stable; community ports are welcome but not maintained here |

### 3.3 Adjacent (separate artifacts in the same monorepo, optional install)

- Compliance test suite (CLI binary you point at any Standard Webhooks producer)
- Debug proxy (CLI that intercepts incoming webhooks and explains signature failures)
- Migration tools for moving from Svix self-hosted, Sidekiq webhook patterns, hand-rolled outbox

---

## 4. Functional requirements

### 4.1 Sender API

| ID | Requirement |
|---|---|
| **FR-S-1** | Public API `postel.send({ type, data, channels?, idempotencyKey?, version? })` returns a `MessageId` and is non-blocking |
| **FR-S-2** | `send()` performs a single SQL insert into the outbox table; the host transaction must be able to wrap it (outbox pattern) — no separate connection, no fire-and-forget |
| **FR-S-3** | Idempotency: if `idempotencyKey` is provided, a duplicate `send()` returns the existing `MessageId` without re-enqueueing |
| **FR-S-4** | Fanout: a single `send()` resolves to N delivery attempts, one per matching endpoint, computed at dispatch time (late-binding so endpoint changes during retry windows are honored) |
| **FR-S-5** | Workers drain the outbox using `FOR UPDATE SKIP LOCKED` (Postgres) / `BEGIN IMMEDIATE` row reservation (SQLite) — multiple workers safe |
| **FR-S-6** | Workers run in-process by default (`postel.start({ concurrency })`); can also run in a separate process pointing at the same DB |
| **FR-S-7** | Adapter mode: the library can hand each delivery to an existing job queue (BullMQ, pg-boss) instead of running its own worker, while still owning the semantics |
| **FR-S-8** | Per-message TTL: messages older than X are skipped and marked expired |
| **FR-S-9** | Per-endpoint timeout (HTTP request) and overall deadline (across retries) |
| **FR-S-10** | Custom HTTP headers per endpoint (constant or computed-per-message) |
| **FR-S-11** | Optional payload transformation per endpoint: a pure function `(event) => bodyToSend` — returning `null` / `undefined` skips delivery |
| **FR-S-12** | Optional payload filter per endpoint: a pure predicate `(event) => boolean` |
| **FR-S-13** | Graceful shutdown: workers finish in-flight attempts, persist state, exit |
| **FR-S-14** | At-least-once delivery guarantee, formally documented and tested |

### 4.2 Receiver API

| ID | Requirement |
|---|---|
| **FR-R-1** | `postel.verify(rawBody, headers, secretOrKeyset)` returns the parsed event or throws a structured error stating which step failed (`SIGNATURE_INVALID`, `TIMESTAMP_TOO_OLD`, `MALFORMED_HEADER`, `UNKNOWN_KEY_ID`, `RAW_BYTES_MISMATCH_DETECTED`) |
| **FR-R-2** | Framework middleware adapters that **preserve raw bytes** for: Express, Fastify, Koa, Hono, Elysia, `Bun.serve`, `Deno.serve`, Next.js Route Handlers, SvelteKit, Astro endpoints, Nitro |
| **FR-R-3** | Multi-secret window: `verify()` accepts an array of secrets and tries each; returns which one matched (so caller can deprecate) |
| **FR-R-4** | Timestamp window enforcement: configurable max age (default 5 minutes per Standard Webhooks); rejects too-old/too-new |
| **FR-R-5** | Idempotency dedup helper: `postel.dedup(messageId, { ttl })` — backed by Postgres / SQLite / Redis / in-memory adapter; returns `{ duplicate: boolean }` atomically |
| **FR-R-6** | JWKS consumer: `createKeyset({ jwksUri, refreshEvery, cacheTtl })` returns a keyset that auto-fetches, caches, and rotates; handles `kid` lookup |
| **FR-R-7** | Bundle target: `@postel/edge` ≤ 50 KB minified+gzipped, tree-shakeable, zero Node-specific imports (Web Crypto only) |
| **FR-R-8** | Native edge runtimes: works unmodified on Cloudflare Workers, Vercel Edge, Deno Deploy, Bun, Cloudflare Pages |
| **FR-R-9** | Test fixtures: helpers to generate signed payloads in tests without a real producer |

### 4.3 Endpoint management

| ID | Requirement |
|---|---|
| **FR-E-1** | CRUD: `postel.endpoints.create({ url, types?, channels?, filter?, transform?, retryPolicy?, headers?, signing? })` and corresponding `update`, `disable`, `delete`, `list`, `get` |
| **FR-E-2** | Endpoint state machine: `active` → `disabled` (manual or auto after N failures) → `re-enabled`. State transitions are first-class operations with audit trail |
| **FR-E-3** | Per-endpoint signing config: choose `v1` (HMAC) or `v1a` (Ed25519); rotate to a new scheme without breaking active deliveries |
| **FR-E-4** | Tenancy field: every endpoint belongs to a `tenantId` (opaque string, the host app's tenant key) |
| **FR-E-5** | Optional max in-flight retries per endpoint (queue depth cap) — back-pressure |
| **FR-E-6** | URL validation at create time: HTTPS-only by default (override to allow HTTP), DNS resolution, SSRF check |
| **FR-E-7** | Per-endpoint metadata field (host-defined JSON, e.g. customer email for ops UI) |

### 4.4 Key management & rotation

| ID | Requirement |
|---|---|
| **FR-K-1** | Symmetric secret generation: `postel.keys.generateSymmetric()` → `whsec_<base64>` per Standard Webhooks |
| **FR-K-2** | Asymmetric keypair generation: `postel.keys.generateAsymmetric()` → `{ private: 'whsk_…', public: 'whpk_…' }` (Ed25519) |
| **FR-K-3** | Each endpoint holds an array of secrets ordered by priority; signing uses the head, verification accepts any in the array |
| **FR-K-4** | Rotation API: `postel.endpoints.rotateSecret(endpointId, { keepPreviousFor: '24h' })` adds a new secret as primary, demotes old to verify-only, schedules removal after window |
| **FR-K-5** | JWKS endpoint mounter: `postel.jwksHandler({ tenantId? })` — Express/Hono/Bun handler you mount on `/.well-known/webhooks-keys` (or `/tenants/:id/.well-known/webhooks-keys` for multi-tenant) |
| **FR-K-6** | JWKS publishes only public keys (asymmetric mode); each entry has a `kid`, algorithm, key material, optional `not_after` |
| **FR-K-7** | Encryption at rest: secrets stored encrypted in DB; envelope encryption with pluggable KMS adapter (AWS KMS, GCP KMS, Vault, plaintext-with-warning for dev) |
| **FR-K-8** | Ephemeral keys: optional mode where signing keys auto-rotate every N hours, published via JWKS — receivers stay in sync |

### 4.5 Retry & backoff policies

| ID | Requirement |
|---|---|
| **FR-T-1** | Default retry policy: exponential backoff with jitter, schedule `[5s, 5min, 30min, 2h, 5h, 10h, 1d, 2d, 3d]` (Standard Webhooks recommendation) |
| **FR-T-2** | Programmable per-endpoint policy: `retryPolicy({ schedule: ['1m', '5m', '30m', '2h', '24h'], jitter: 0.2, maxAttempts: 12 })` |
| **FR-T-3** | Status-code-aware: never retry on 4xx (except 408, 429), always retry on 5xx and network errors, respect `Retry-After` header |
| **FR-T-4** | Per-endpoint circuit breaker: after K consecutive failures, suspend deliveries to that endpoint for cooldown window; prevents one slow tenant from blocking workers |
| **FR-T-5** | Dead-letter: after final retry, attempt is marked `dead-letter` and emits an event the host can subscribe to (`postel.on('dead-letter', handler)`) |
| **FR-T-6** | Endpoint auto-disable: configurable threshold (e.g., 100% failures over 24h → disable) |
| **FR-T-7** | Replay safety: a replayed message uses a fresh `webhook-id` if the host opts in, or reuses the original (idempotent reception) — explicit choice |

### 4.6 Filtering & transformation

| ID | Requirement |
|---|---|
| **FR-F-1** | Type filter: endpoint subscribes to a list of event types or glob patterns (`user.*`, `order.created`) |
| **FR-F-2** | Channel filter: per Standard Webhooks `channels` field |
| **FR-F-3** | Predicate filter: arbitrary `(event) => boolean` (TypeScript code, not a DSL) |
| **FR-F-4** | Transform: arbitrary `(event) => body \| null` |
| **FR-F-5** | Filter/transform errors are caught, logged, the attempt fails-closed (skip delivery), and dead-letter after retries |
| **FR-F-6** | Filter/transform are evaluated per-attempt at dispatch time — endpoint config changes during retries are honored |

### 4.7 Replay & reconciliation

| ID | Requirement |
|---|---|
| **FR-P-1** | `postel.replay({ messageId })` re-enqueues a single message |
| **FR-P-2** | `postel.replay({ endpointId, since, until?, types? })` re-enqueues a range |
| **FR-P-3** | `postel.replay({ filter: (msg) => boolean })` re-enqueues by predicate |
| **FR-P-4** | Replays are tagged in the attempts table (`replay_of: messageId`) for audit |
| **FR-P-5** | Replay rate limiting: configurable max replay throughput so a "replay everything" doesn't DDoS the receiver |
| **FR-P-6** | Reconciliation API: `postel.reconcile({ endpointId, since })` lists messages that were never confirmed delivered (for nightly catch-up jobs) |
| **FR-P-7** | Replay UI handler (admin handler) supports time-range selection and dry-run count |

### 4.8 Multi-tenancy & isolation

| ID | Requirement |
|---|---|
| **FR-M-1** | All persistence is tenant-scoped via `tenantId` column (NULLable for single-tenant) |
| **FR-M-2** | Per-tenant rate limits: `postel.tenants.setRateLimit(tenantId, { perSecond })` |
| **FR-M-3** | Worker fairness: round-robin across tenants in the worker scheduler so one tenant's burst doesn't starve others (weighted-fair queueing optional) |
| **FR-M-4** | Per-tenant circuit breaker isolation: one tenant's failing endpoints never affect another tenant's deliveries |
| **FR-M-5** | Tenant deletion: `postel.tenants.delete(tenantId)` cascades to endpoints, messages, attempts |

### 4.9 Observability & admin

| ID | Requirement |
|---|---|
| **FR-O-1** | OpenTelemetry spans on every send, dispatch, attempt, retry, replay; span attributes per OTel semconv for HTTP |
| **FR-O-2** | Prometheus metrics: `webhook_send_total`, `webhook_attempt_duration_seconds`, `webhook_attempt_success_ratio`, `webhook_dead_letter_total`, `webhook_outbox_depth`, `webhook_endpoint_circuit_state` (all with `tenant_id`, `endpoint_id`, `event_type` labels) |
| **FR-O-3** | Structured JSON logs with trace correlation IDs |
| **FR-O-4** | Admin HTTP handlers (framework-agnostic builder + adapters for Express/Hono/Fastify): list events, list endpoints, list attempts (with pagination + filters), view raw payload, replay, pause endpoint, resume endpoint, rotate secret |
| **FR-O-5** | Admin handlers expose only data the caller is authorized to see (the host passes an auth predicate) |
| **FR-O-6** | Health check endpoint: `postel.health()` returns `{ ok, outbox_depth, oldest_pending_age, worker_count }` |
| **FR-O-7** | Webhook event log retention: configurable, with automatic pruning |

### 4.10 Standard Webhooks compliance + extensions

| ID | Requirement |
|---|---|
| **FR-C-1** | Compliant by default: headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`), signature versions (`v1`, `v1a`), payload structure (`type`, `timestamp`, `data`), secret prefixes (`whsec_`, `whsk_`, `whpk_`) |
| **FR-C-2** | Wraps the official `standardwebhooks` JS signing lib where possible; does not reinvent crypto |
| **FR-C-3** | Versioning extension (filling spec issue [#165](https://github.com/standard-webhooks/standard-webhooks/issues/165)): adds `webhook-version` header; events can be sent with `version: '2'`; receiver `verify()` returns the version |
| **FR-C-4** | JWKS discovery extension (filling the asymmetric-key publication gap): defines `/.well-known/webhooks-keys` JWKS shape, with `kid`, `alg`, `not_after` |
| **FR-C-5** | IETF-alignment compatibility mode (filling spec issue [#244](https://github.com/standard-webhooks/standard-webhooks/issues/244)): on receiver side, accept either Standard Webhooks headers or IETF-aligned (`Content-Digest`, `Idempotency-Key`) — graceful for ecosystems migrating |
| **FR-C-6** | Compliance test suite: vendor-neutral CLI that verifies any HTTP receiver against Standard Webhooks spec; runs as part of this lib's CI but ships as a separate artifact |

---

## 5. Non-functional requirements

### 5.1 Performance

| ID | Requirement |
|---|---|
| **NFR-P-1** | `send()` adds ≤ 5 ms p99 to the host transaction (single insert) |
| **NFR-P-2** | Receiver `verify()` ≤ 1 ms p99 for symmetric, ≤ 5 ms p99 for asymmetric |
| **NFR-P-3** | Worker throughput target: ≥ 10,000 deliveries/sec on a single Postgres node with 4 workers and a healthy receiver |
| **NFR-P-4** | Outbox poll latency: ≤ 100 ms p99 from `send()` to first dispatch attempt under normal load |
| **NFR-P-5** | No global locks; multi-worker contention bounded by `SKIP LOCKED` semantics |
| **NFR-P-6** | Memory per worker ≤ 50 MB at idle, ≤ 200 MB under sustained load |

### 5.2 Security

| ID | Requirement |
|---|---|
| **NFR-S-1** | Constant-time signature comparison everywhere |
| **NFR-S-2** | SSRF protection: outbound deliveries refuse private/loopback/link-local IPs by default; configurable allowlist for testing |
| **NFR-S-3** | TLS verification on by default; opt-out per endpoint with explicit warning |
| **NFR-S-4** | Secrets encrypted at rest with envelope encryption; KMS adapter required for production (warning in dev mode) |
| **NFR-S-5** | DNS rebinding protection: resolve once before request, pin IP for the duration of the connection |
| **NFR-S-6** | Replay attack window enforcement (timestamp + idempotency dedup) |
| **NFR-S-7** | No sensitive data in logs by default (payload bodies elided unless explicitly enabled) |
| **NFR-S-8** | Dependency surface kept minimal; no native modules in the receiver path so it ships to edge |
| **NFR-S-9** | Security policy + responsible disclosure process documented |

### 5.3 Reliability & consistency

| ID | Requirement |
|---|---|
| **NFR-R-1** | At-least-once delivery semantics, formally documented |
| **NFR-R-2** | Outbox writes are part of the host transaction — no "send succeeded but transaction rolled back" |
| **NFR-R-3** | Worker crash mid-attempt: lock expires (configurable lease), message returns to outbox, eventually retried |
| **NFR-R-4** | Duplicate suppression on receiver side via dedup helper |
| **NFR-R-5** | Schema migrations run idempotently; safe to run on every boot |
| **NFR-R-6** | DB connection pool exhaustion does not crash workers — back off and retry |
| **NFR-R-7** | All persistent state durable across process restart |

### 5.4 Compatibility

| ID | Requirement |
|---|---|
| **NFR-C-1** | Node ≥ 20 LTS, Bun ≥ 1.0, Deno ≥ 2.0; ESM + CJS dual export; TypeScript 5+ types |
| **NFR-C-2** | Receiver core (`@postel/edge`) works on Cloudflare Workers, Vercel Edge, Deno Deploy without polyfills |
| **NFR-C-3** | Postgres ≥ 14 (uses `FOR UPDATE SKIP LOCKED`, JSONB, `RETURNING`) |
| **NFR-C-4** | SQLite ≥ 3.40 (uses `RETURNING`, JSON1) |
| **NFR-C-5** | Zero required Redis / RabbitMQ / Kafka dependency |
| **NFR-C-6** | Optional adapters for: BullMQ, pg-boss |
| **NFR-C-7** | Wire format and DB schema are documented and stable; community ports in other languages may exist but are not maintained in this repo |

### 5.5 Bundle size & edge

| ID | Requirement |
|---|---|
| **NFR-B-1** | `@postel/edge` (receiver-only) ≤ 50 KB minified+gzipped |
| **NFR-B-2** | `@postel/edge` has zero `node:*` imports; uses Web Crypto only |
| **NFR-B-3** | `@postel/core` (full sender + receiver) ≤ 250 KB minified+gzipped |
| **NFR-B-4** | Tree-shakeable: importing `verify` does not pull in worker / DB code |
| **NFR-B-5** | Published unminified for tooling readability |

### 5.6 Backward compatibility & migration

| ID | Requirement |
|---|---|
| **NFR-M-1** | Once 1.0 ships: SemVer strict; no breaking changes in minor / patch |
| **NFR-M-2** | DB migrations are forward-only; the library can read state written by older library versions for at least 2 major versions |
| **NFR-M-3** | Deprecation period: ≥ 6 months before removing a public API |
| **NFR-M-4** | Wire format versioned (`webhook-spec-version` header) so future spec changes don't break existing endpoints |
| **NFR-M-5** | Migration guides from: Svix self-hosted, Sidekiq webhook patterns, hand-rolled outbox |

---

## 6. Storage layer

### 6.1 Schema (canonical)

| Table | Purpose |
|---|---|
| `tenants` | Multi-tenant scope (optional row, NULL for single-tenant) |
| `endpoints` | Endpoint config: URL, types, channels, filter/transform refs, retry policy, signing config, state, metadata |
| `endpoint_secrets` | One-to-many; secret + algorithm + status (`primary`, `verifying`, `expiring`) + `not_after` |
| `messages` | Outbox: type, data, channels, idempotency key, version, created_at |
| `attempts` | Per-endpoint per-message delivery attempts: status, response code, response headers (truncated), response body (truncated, optional), latency, error, replay_of |
| `endpoint_state_transitions` | Audit log of state changes (active/disabled/circuit-open) |
| `dead_letter` | View over `attempts` where final status = exhausted |

### 6.2 Storage backends

| ID | Requirement |
|---|---|
| **SR-1** | Postgres adapter: primary, full feature set including row locks, `LISTEN`/`NOTIFY` for low-latency dispatch |
| **SR-2** | SQLite adapter: feature parity except no listen/notify (polling); single-writer constraints documented |
| **SR-3** | BYO storage adapter: documented `Storage` interface (transactions, locks, queries) so users can plug PlanetScale, CockroachDB, libSQL, Turso, etc. |
| **SR-4** | Migrations bundled in the library; CLI `postel migrate` and programmatic `postel.migrate(db)` |
| **SR-5** | Tenant-scoped row-level access in queries (defense in depth even though the host app is also responsible) |

---

## 7. Architecture & API design principles

| ID | Principle |
|---|---|
| **AR-1** | **Library, not framework.** No global state, no implicit boot sequence. The host calls `createPostel({ db, ... })` to get an instance |
| **AR-2** | **Code-first config.** All policy, filters, transforms are TypeScript functions in the host's codebase. No YAML, no DSLs, no CEL |
| **AR-3** | **Single source of truth: the DB.** No in-memory caching that can drift; reads are cheap because Postgres is fast |
| **AR-4** | **Late binding.** Endpoint config (filter, transform, retry policy) is evaluated at dispatch time, not send time, so changes propagate during retries |
| **AR-5** | **Explicit transactions.** All writes accept an optional `db` (transaction) parameter — outbox semantics require this |
| **AR-6** | **Standard Webhooks-compliant by default.** Opt-in for IETF-aligned compatibility mode |
| **AR-7** | **Errors are structured.** Every failure mode has a typed error class; no string matching |
| **AR-8** | **Pure-function policies.** Filters, transforms, retry policies are pure; library guards against side effects with try/catch + dead-letter |
| **AR-9** | **No required background process.** Workers are optional; "send + walk away" is supported via DB triggers / external scheduler |
| **AR-10** | **Edge-first receiver.** The verifier is designed to run in 50KB on Workers/Edge; Node-only conveniences live in separate packages |

---

## 8. Distribution & packaging

### 8.1 Package map

| Package | Purpose | Bundle target |
|---|---|---|
| `@postel/core` | Sender, receiver, types, errors | ≤ 250 KB |
| `@postel/edge` | Receiver + JWKS consumer for edge runtimes | ≤ 50 KB |
| `@postel/postgres` | Postgres storage adapter | — |
| `@postel/sqlite` | SQLite storage adapter | — |
| `@postel/express` | Express receiver middleware + admin handlers | — |
| `@postel/hono` | Hono adapter | — |
| `@postel/fastify` | Fastify adapter | — |
| `@postel/nextjs` | Next.js Route Handler adapter | — |
| `@postel/bun` | `Bun.serve` adapter | — |
| `@postel/admin` | Admin HTTP handler builder (framework-agnostic) | — |
| `@postel/effect` | Effect-TS layer | — |
| `@postel/test` | Test fixtures, signature generators, mock receivers | — |
| `@postel/compliance` | Standard Webhooks compliance test suite (CLI) | — |
| `@postel/cli` | `postel` CLI: migrate, sign, verify, replay, simulate | — |

### 8.2 Versioning

| ID | Requirement |
|---|---|
| **DR-1** | SemVer strict from 1.0 |
| **DR-2** | All `@postel/*` packages share major version (released together for breaking changes) |
| **DR-3** | DB schema version embedded in `_postel_meta` table; library refuses to run against incompatible schema versions |

---

## 9. Quality, testing & tooling

| ID | Requirement |
|---|---|
| **QR-1** | Unit test coverage ≥ 90% on core logic |
| **QR-2** | Integration tests against real Postgres (testcontainers) and real SQLite |
| **QR-3** | Property-based tests on signing/verification (fuzz inputs) |
| **QR-4** | Fault injection tests: kill workers mid-attempt, partition DB, simulate slow receivers, clock skew, DNS failures |
| **QR-5** | Load tests publishing benchmark results per release |
| **QR-6** | Standard Webhooks compliance test suite passes against own implementation in CI |
| **QR-7** | Receiver bundle size enforced in CI (fails if > budget) |
| **QR-8** | Receiver works on real Cloudflare Workers in CI (deployed test) |
| **QR-9** | Security audit before 1.0 (external) |
| **QR-10** | Reproducible builds |

---

## 10. Documentation & adoption artifacts

| ID | Requirement |
|---|---|
| **DOC-1** | Docs site with: quickstart per framework, conceptual guides (idempotency, retries, replay, key rotation), full API reference, runnable examples |
| **DOC-2** | Migration guides: from Svix self-hosted, from raw Sidekiq/BullMQ worker patterns, from hand-rolled outbox, from Standard Webhooks signing-only libs |
| **DOC-3** | Reference applications: a "minimal SaaS that sends and receives webhooks" for Next.js, Express, Hono, plus a Cloudflare Worker example |
| **DOC-4** | Architectural decision records (ADRs) published alongside |
| **DOC-5** | Recipe cookbook: ephemeral keys with JWKS, multi-tenant isolation, replay UI, dead-letter alerting, OpenTelemetry integration |
| **DOC-6** | "Why not a service?" essay on the docs site to set expectations |
| **DOC-7** | Public benchmark page (deliveries/sec, latency percentiles) |
| **DOC-8** | Spec extension proposals (versioning, JWKS, IETF alignment) submitted to Standard Webhooks repo, with this lib as reference implementation |

---

## 11. Operational principles

| ID | Principle |
|---|---|
| **OP-1** | OSS license: MIT or Apache-2.0 (decided before 1.0) |
| **OP-2** | Single-vendor friendly governance: maintainer-led with clear contribution guidelines |
| **OP-3** | No "open-core": every feature listed here ships in OSS, forever |
| **OP-4** | Standard Webhooks consortium engagement: pursue official "delivery layer" reference implementation status |
| **OP-5** | Public roadmap |
| **OP-6** | Funding model: separate concern (sponsorships, support contracts) — never feature-gating |

---

## 12. Success criteria for 1.0

A reasonable observer can answer YES to all of:

1. Does the receiver lib run unmodified on Cloudflare Workers in ≤ 50 KB?
2. Can I add webhooks to my Postgres-backed app without bringing up Redis or a service?
3. Does it handle key rotation with overlap windows out of the box?
4. Can I publish a JWKS endpoint with one line?
5. Is replay a first-class API verb, not bolted on?
6. Does it pass its own Standard Webhooks compliance suite?
7. Are the receiver verifier errors actionable (which step failed and why)?
8. Does the multi-tenant scheduler isolate noisy neighbors by default?
9. Is the "Why not a service?" answer obvious from the docs?
10. Is the wire format and DB schema documented well enough that a community port in another language is plausible?

If all yes → 1.0. Otherwise it's not done.
