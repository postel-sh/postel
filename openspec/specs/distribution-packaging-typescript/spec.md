# distribution-packaging-typescript Specification

## Purpose

The TypeScript port's distribution contract: published package set, bundle-size budgets, semver discipline, ESM+CJS dual-export expectations, DB schema version handshake, forward-only migrations across two major versions, deprecation period, and the wire-format spec-version header. Scoped to the TypeScript port specifically per [ADR 0006 — Polyglot monorepo layout](../../../decisions/0006-monorepo-layout.md); each future language port introduces its own `distribution-packaging-<lang>` capability with its native conventions (Go modules, Python wheels, Rust crates, etc.).
## Requirements
### Requirement: Package map

The library SHALL be distributed as the following npm packages, grouped by purpose:

**Core:**
- `@postel/core` — sender + receiver + types + errors. The receiver-side verify / dedup / JWKS-consumer surface ships here directly; there is no separate edge-runtime carve-out package. The **in-memory `Storage` adapter** (`InMemoryStorage`) and the **in-memory dedup adapter** (`inMemoryDedupAdapter`) also ship from `@postel/core` — they are the reference implementations, the deterministic test backend, and the zero-config default. Both are leaf exports: a receiver-only bundle that imports `verify` does not pull them in (see `Tree-shakeability`).

**Storage adapters (Tier 1 — must ship for 1.0, per [ADR 0007](../../../decisions/0007-storage-strategy.md)):**
- `@postel/pg` — Postel owns the Postgres pool; zero-config drop-in.
- `@postel/sqlite` — same for SQLite.
- `@postel/drizzle` — host hands Postel a Drizzle instance (any dialect Drizzle supports — Postgres, MySQL, SQLite, …).
- `@postel/prisma` — host hands Postel a `PrismaClient`.
- `@postel/kysely` — host hands Postel a `Kysely<DB>`.
- `@postel/storage-helpers` — zero-DB-dependency helpers package every adapter (first-party or third-party) imports for timestamp normalization, retry-policy JSON serialization, idempotency-key formatting, capability flags, and message/attempt row encode/decode.

(Tier 2 raw-client adapters — `@postel/node-postgres`, `@postel/postgres-js`, `@postel/better-sqlite3` — are explicitly post-1.0 demand-driven additions per ADR 0007, not in this Tier-1 package map.)

**Framework-core:**
- `@postel/http` — the framework-agnostic webhook HTTP layer every framework adapter binds to: a normalized `handleInbound` outcome function, a Web-Fetch `fetchWebhook` request-handler builder, a `@postel/http/node` entry for Node `req`/`res` frameworks, and the single canonical `PostelError`→HTTP-status policy. Depends only on `@postel/core`; pulls in no framework.

**Framework adapters:**
- `@postel/express`, `@postel/hono`, `@postel/fastify`, `@postel/nestjs`, `@postel/nextjs`, `@postel/bun` — receiver middleware / guards + admin handlers. Each depends on `@postel/http` for the verification gate and error→status policy rather than re-deriving them.

**Auxiliary:**
- `@postel/admin` — framework-agnostic admin HTTP handler builder.
- `@postel/effect` — Effect-TS layer over the core API.
- `@postel/test` — test fixtures + signature generators + mock receivers for adopter unit tests.
- `@postel/compliance-driver` — HTTP control-plane shim the `@postel/compliance` suite drives in `--sender-control` mode. Distinct from `@postel/test` (audience: adopters) and `@postel/cli` (audience: adopters): its stability surface is a CONTRACT artifact tracked by the compliance suite's lockstep version.
- `@postel/cli` — `postel` CLI binary (migrate, sign, verify, replay, simulate).

The `@postel/compliance` suite is **not part of this list**: per the `compliance` capability spec, the suite's implementation language and distribution channel are open. If a future change implements the runner as a TypeScript npm package, it will be added here at that point; until then, the suite's source lives at top-level `compliance/` and its distribution mechanism is undecided.

Each package MUST have a single, documented purpose declared in its `package.json` `description` field (≤ 120 chars).

#### Scenario: Importing a storage adapter does not pull other adapters

- **WHEN** a host installs only `@postel/drizzle`
- **THEN** `@postel/prisma`, `@postel/kysely`, `@postel/pg`, and `@postel/sqlite` are NOT transitively installed

#### Scenario: storage-helpers has no DB dependency

- **WHEN** a consumer installs `@postel/storage-helpers`
- **THEN** no Postgres / SQLite / other DB client is pulled in transitively

#### Scenario: compliance-driver is not pulled by core

- **WHEN** a consumer installs `@postel/core`
- **THEN** `@postel/compliance-driver` is NOT transitively installed
- **AND** `@postel/compliance-driver`'s control-plane surface is reachable only by explicit install

#### Scenario: framework adapters depend on the HTTP core

- **WHEN** a host installs `@postel/hono`
- **THEN** `@postel/http` is present transitively (the adapter binds the shared gate + error→status policy)
- **AND** no other framework's adapter (`@postel/express`, `@postel/fastify`, `@postel/nestjs`, …) is pulled in

### Requirement: Core bundle budget

`@postel/core` SHALL ship at ≤ 250 KB minified+gzipped. CI MUST enforce this budget on every build.

#### Scenario: Core size enforced in CI

- **WHEN** a change increases `@postel/core` to 280 KB minified+gzipped
- **THEN** the bundle-size CI check fails

### Requirement: Tree-shakeability

The library SHALL be tree-shakeable. Importing `verify` MUST NOT pull in worker or DB code. The framework-agnostic HTTP core MUST be importable without pulling in any framework.

#### Scenario: verify is standalone

- **WHEN** a consumer's bundler tree-shakes `import { verify } from '@postel/core'`
- **THEN** the resulting bundle excludes the worker, dispatcher, and DB adapters

#### Scenario: http core is importable without a framework

- **WHEN** a consumer imports `fetchWebhook` from `@postel/http` and mounts it as a Web `fetch` handler
- **THEN** no Express / Fastify / Hono / NestJS runtime is included in the bundle

### Requirement: ESM and CJS dual export, TypeScript types

Each package SHALL ship dual ESM + CJS entry points with TypeScript 5+ type definitions. Node ≥ 20 LTS, Bun ≥ 1.0, and Deno ≥ 2.0 MUST be supported.

#### Scenario: CJS require works

- **WHEN** a Node 20 CJS project does `const { send } = require('@postel/core')`
- **THEN** the import succeeds and types are available via `@types`

### Requirement: Published unminified for tooling readability

Packages SHALL be published unminified (the consumer's bundler is responsible for minification). Source maps MUST be published.

#### Scenario: Unminified read

- **WHEN** a consumer opens `node_modules/@postel/core/dist/index.js`
- **THEN** the source is human-readable (not minified)

### Requirement: Strict SemVer from 1.0

From 1.0 onward, all `@postel/*` packages SHALL follow strict SemVer: no breaking changes in minor or patch releases. **Before 1.0 (the `0.x` line), breaking changes are explicitly allowed across minor versions.** Library consumers SHOULD NOT pin to `^0.x` ranges without expecting churn; pin to a specific minor (e.g., `~0.5.0` or `0.5.x`) during the experimental phase. The OpenSpec change history is the canonical record of what changed and when. Compliance-suite-version coordination follows the **lockstep** rule in [`openspec/specs/compliance/spec.md`](../compliance/spec.md): the suite and every `@postel/*` port package share `MAJOR.MINOR` and release together. The runway-based alternative sketched in [ADR 0009](../../../decisions/0009-compliance-suite-evolution.md) is Deferred until multi-port maintainer cadences warrant it.

#### Scenario: Patch is non-breaking (post-1.0)

- **WHEN** consumers upgrade from `1.2.3` to `1.2.4`
- **THEN** their existing code compiles and runs unchanged

#### Scenario: 0.x minor MAY be breaking

- **WHEN** consumers upgrade from `0.4.7` to `0.5.0`
- **THEN** their existing code MAY require adjustment (e.g., API renames, behavior changes); the CHANGELOG documents the migration

#### Scenario: 0.x patch is non-breaking

- **WHEN** consumers upgrade from `0.4.7` to `0.4.8`
- **THEN** their existing code compiles and runs unchanged (patches remain non-breaking even pre-1.0)

### Requirement: Shared major version across packages

All `@postel/*` packages SHALL share a major version. Breaking changes MUST be released across the package set together.

#### Scenario: 2.0 release

- **WHEN** `@postel/core` releases `2.0.0`
- **THEN** every other `@postel/*` package also releases `2.0.0` in the same release

### Requirement: DB schema version embedded in metadata table

The library SHALL maintain a `_postel_meta` table containing the DB schema version. The library MUST refuse to run against a DB whose schema version is incompatible with the library version.

#### Scenario: Mismatched schema

- **WHEN** the library is at schema v3 and the DB is at schema v1
- **THEN** the library fails fast at startup with a clear message indicating which migration to run

### Requirement: Forward-only migrations supporting two majors

DB migrations SHALL be forward-only. The library MUST be able to read state written by older library versions for at least the previous two major versions.

#### Scenario: Read 1.x state from 3.x

- **WHEN** a 3.x library starts against a DB last touched by a 1.x library
- **THEN** the migration path runs cleanly forward; no data is lost

### Requirement: Six-month deprecation period

Public APIs marked deprecated SHALL remain functional for at least six months before removal. Removals MUST coincide with a major version bump.

#### Scenario: Deprecation lifecycle

- **WHEN** a public API is marked `@deprecated` in a minor release
- **THEN** it remains functional in subsequent minor releases for at least 6 months and is only removed at the next major

### Requirement: Wire format spec versioning

Outgoing requests MAY include a `webhook-spec-version` header indicating the wire-format spec generation. Future spec changes MUST use this header so existing endpoints continue to function.

#### Scenario: Old endpoint receives new spec

- **WHEN** an existing endpoint receives a request with a future `webhook-spec-version`
- **THEN** the endpoint can ignore the new fields and continue verifying as before

### Requirement: Spec-test traceability is enforced in CI

Every `### Requirement` declared under `openspec/specs/<capability>/spec.md` SHALL be covered by at least one test that names it (e.g., the requirement title appears in a `describe`/`test`/`it` block, or in a comment immediately above the test). CI MUST fail when a requirement has no matching test, so requirements cannot be silently dropped during implementation.

#### Scenario: Drift detected fails CI

- **WHEN** a contributor adds a new `### Requirement: Foo` to a capability spec without adding a test that names "Foo"
- **THEN** the `check:spec-drift` CI step exits non-zero
- **AND** the failure message lists the requirement name and the spec file it came from

#### Scenario: Pre-implementation no-op

- **WHEN** the spec-drift check runs and there are no test files yet (e.g., `packages/` is empty)
- **THEN** the check emits an informational message and exits 0
- **AND** no requirement is reported as drifted

#### Scenario: New port extends the check

- **WHEN** a future change adds a non-TypeScript port (e.g., Go)
- **THEN** that change MUST extend `scripts/check-spec-drift.mjs` (or add a sibling script wired into the same CI step) to also walk that port's test files

### Requirement: Framework adapters share a framework-agnostic HTTP core

`@postel/http` SHALL provide the framework-neutral webhook HTTP layer — the normalized `handleInbound` outcome function, the Web-Fetch `fetchWebhook` request-handler builder, and the single canonical `PostelError`→HTTP-status policy. Each framework adapter (`@postel/express`, `@postel/fastify`, `@postel/hono`, `@postel/nextjs`, `@postel/bun`, and any future adapter) SHALL depend on `@postel/http` for the error→status policy rather than re-deriving it, so the status table is defined exactly once and cannot drift between adapters.

**Conformance**: the outcome — a single shared error→status policy, and the core being importable without a framework — is CONTRACT. The `@postel/http` module shape itself is PORT-SPECIFIC: other language ports satisfy the same cross-port contract through their own framework-neutral layer (Go `http.Handler`, Python ASGI/WSGI, …), not necessarily an `@postel/http` package.

#### Scenario: One error-status policy across adapters

- **WHEN** any framework adapter maps a `SIGNATURE_INVALID` failure
- **THEN** it resolves to HTTP 400 via `@postel/http`'s shared policy, identically across Express, Fastify, Hono, and NestJS

#### Scenario: http is framework-agnostic

- **WHEN** a host imports `fetchWebhook` from `@postel/http` and mounts it as a Web `fetch` handler
- **THEN** inbound verification + gating works with no framework dependency pulled in

#### Scenario: Importing a framework adapter does not pull sibling adapters

- **WHEN** a host installs only one framework adapter (e.g. `@postel/fastify`)
- **THEN** the other framework adapters are NOT transitively installed
- **AND** only `@postel/http` + `@postel/core` are pulled in as Postel dependencies

