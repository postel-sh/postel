# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project (from 1.0 onward) adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Pre-1.0 groundwork for the first TypeScript release: `@postel/core` (sender +
receiver), 8 storage adapters, 4 framework adapters, an admin control plane,
and the spec/ADR/compliance scaffolding that keeps future ports conformant.

### Added

- Spec-driven development framework via upstream [OpenSpec](https://github.com/Fission-AI/OpenSpec) with the custom `postel` schema, and 15 capability specs under `openspec/specs/`: sender, receiver, endpoint management, key management, retry policy, filtering & transformation, replay & reconciliation, multi-tenancy, observability, standard-webhooks compliance, storage layer, distribution & packaging, message introspection, and the TypeScript API surface.
- Canonical machine-readable artifacts: [`specs/wire-format/asyncapi.yaml`](specs/wire-format/asyncapi.yaml) (AsyncAPI 3.0) and [`specs/db-schema/0001_init.sql`](specs/db-schema/0001_init.sql).
- 17 ADRs under `decisions/` capturing architectural decisions, and `VISION.md` for top-level positioning, scope, and success criteria.
- `@postel/core`: the `Postel({ inbound, outbound })` factory with `sender`/`receiver` sub-namespaces; HMAC-v1 and Ed25519-v1a signing and verification; multi-secret and secondary-secret rotation; timestamp-window replay defense; dedup/idempotency; JWKS key publishing; endpoint, tenant, and key-management APIs; message and attempt introspection; a structural filter language for outbound event routing; named custom verifiers; and pagination envelopes across all list-returning APIs.
- Sender path: retries with a circuit breaker, SSRF-safe endpoint validation (including IPv4-mapped IPv6), fanout to multiple endpoints, and per-endpoint signing-secret provisioning.
- `@postel/http`: a framework-agnostic webhook HTTP gate (verify → map-errors → dedup-ack) shared by every framework adapter.
- Framework adapters over `@postel/http`: `@postel/hono`, `@postel/express`, `@postel/fastify`, `@postel/nestjs` — each exposed as an `XxxWebAdapter(postel, app)` routing facade.
- `@postel/admin`: a framework-agnostic admin control-plane router (endpoints, keys, messages, tenants) bound into each framework adapter.
- Storage adapters: `@postel/pg`, `@postel/sqlite`, `@postel/mysql` (native drivers), and `@postel/kysely`, `@postel/drizzle`, `@postel/prisma`, `@postel/typeorm`, `@postel/mikro-orm` (host-ORM adapters), plus `@postel/storage-helpers` and `@postel/storage-testkit` for adapter authors.
- `@postel/compliance`: a Go-based behavioral oracle with a JSON Schema-validated vector corpus covering signature verification, receiver behaviors (multi-secret, timestamp window, raw-bytes preservation), JWKS, dedup, and the full sender path.
- Fumadocs documentation site at `docs/` (`postel.dev`), covering the adopter-facing API surface, framework adapters, and storage adapters.

### Changed

- **BREAKING (positioning)**: Postel is no longer described as "backed by solid, executable specs". The new positioning leads with what the library does and why it's needed: "Postel is a polyglot library for sending and receiving webhooks reliably and securely. Sending one is easy; doing it reliably and securely — across retries, replay, signature verification, key rotation, idempotency, and raw-bytes preservation — is not. That's where Postel helps. TypeScript ships first; Go, Python, and Rust follow." The compliance test suite and per-capability spec workflow are unchanged — they're the *mechanism*, not the *positioning*.
- **BREAKING (positioning)**: Postel is no longer described as a "TypeScript-first" library. The polyglot rollout (TypeScript first; Go, Python, and Rust follow as first-class ports) is unchanged. See [`decisions/0005-polyglot-staged-rollout.md`](decisions/0005-polyglot-staged-rollout.md).
- **BREAKING**: `send()` now returns `{ id, reused }`, and endpoints round-trip all serializable fields.
- **BREAKING**: house API idioms locked — keyset naming disambiguated, `filterFn` renamed as part of the structural filter language, and the outbound event schema registry introduced.
- Release flow: narrow first-release set (`@postel/core`, `@postel/hono`, `@postel/pg`, `@postel/sqlite`) widened, package by package, as adapters shipped real code — see [ADR 0014](decisions/0014-release-and-versioning-flow.md).
- Web adapters reworked from ad hoc middleware helpers (`honoAdapter`/`honoVerify`/`postelHono`) into the `XxxWebAdapter(postel, app)` routing-facade shape; inbound verification opened to custom verifiers, with a built-in `Noop()`.

### Removed

- Monolithic `SPECIFICATION.md` (content fully redistributed into `VISION.md`, capability specs, ADRs, AsyncAPI, and SQL DDL).
- `@postel/edge` and dedicated edge-runtime targeting ([ADR 0013](decisions/0013-drop-edge-package-and-runtime-targeting.md)): its source was folded into `@postel/core`, which incidentally still runs on Web-Crypto-capable edge runtimes without carrying a contracted bundle-size or portability guarantee.
