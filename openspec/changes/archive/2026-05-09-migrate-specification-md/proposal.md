# Proposal — migrate SPECIFICATION.md to capability-based specs

## Why

The repo currently holds a 28 KB monolithic `SPECIFICATION.md`. Two problems:

1. The doc positions Postel as "TypeScript-first" with explicit non-goals around polyglot ports (§1.2, §3.2). **That positioning is wrong for what we are building.** Postel is a **spec-first** library; TypeScript is the reference implementation; additional language ports are first-class roadmap items, gated on passing the compliance test suite. Keeping the old framing creates confusion every time a port-related question is raised.
2. A single 28 KB doc cannot serve as the source of truth for a polyglot library. Port authors need to read "what does the receiver do?" without paging through 12 sections covering everything else; reviewers need to gate changes per capability; the wire format needs to be machine-readable for codegen.

This change replaces the monolithic spec with capability-based specs under `openspec/specs/`, plus canonical machine-readable artifacts under `specs/` (AsyncAPI for wire format, SQL DDL for DB schema), plus ADRs for cross-cutting decisions, plus a top-level `VISION.md` for stable identity.

## What Changes

- **BREAKING (positioning)**: §1.2 of `SPECIFICATION.md` ("TypeScript-first webhooks library") and §3.2 ("Maintained ports in Go / Python / Rust / etc. — out of scope") are reversed. New positioning: "Postel is a spec-first webhooks library. TypeScript is the reference implementation. Additional language ports follow, gated on passing the compliance test suite."
- **NEW**: 13 capability specs under `openspec/specs/<capability>/spec.md`, populated by ADDED requirements derived from the existing FR-* and SR-* / AR-* sections.
- **NEW**: `VISION.md` at the repo root carrying the stable identity content (problem, vision, personas, scope, success criteria) with the corrected positioning.
- **NEW**: Canonical machine-readable artifacts: `specs/wire-format/asyncapi.yaml` (AsyncAPI 3.0 skeleton) and `specs/db-schema/0001_init.sql` (DDL for the 6 tables in §6.1).
- **NEW**: ADRs `0001`..`0007` capturing architectural decisions (library not service, no Redis, code-first config, Postgres+SQLite only, OpenSpec as spine, AsyncAPI for wire format, polyglot staged rollout).
- **NEW**: `CHANGELOG.md` stub.
- **REMOVED**: `SPECIFICATION.md` (content fully redistributed; deletion lands in this change's commit).
- **MODIFIED**: `README.md` updated to point at the new structure.

## Capabilities

### New Capabilities

All 13 are introduced by this change (the repo had no capability specs before):

- `sender` — outbox API, idempotency, fanout, worker control
- `receiver` — verify(), middleware adapters, dedup, JWKS consumer
- `endpoint-management` — endpoint CRUD, state machine, tenancy
- `key-management` — symmetric/asymmetric key generation, rotation, JWKS publication
- `retry-policy` — backoff schedules, status-code awareness, circuit breaker, dead-letter
- `filtering-transformation` — type/channel/predicate filters, transforms, late binding
- `replay-reconciliation` — replay APIs, rate limiting, reconciliation queries
- `multi-tenancy` — tenant scoping, per-tenant rate limits, fairness, isolation
- `observability` — OTel spans, Prometheus metrics, structured logs, admin handlers, health
- `standard-webhooks-compliance` — header set, signature versions, secret prefixes, extensions, compliance suite
- `storage-layer` — Postgres/SQLite adapters, migrations, BYO storage interface
- `distribution-packaging` — package map, bundle budgets, semver, schema versioning
- `api-surface-typescript` — TS-specific public API surface (function signatures, error classes, type contracts)

### Modified Capabilities

None — this is the bootstrap migration; nothing exists yet to modify.

## Wire-format / DB-schema impact

- **Wire format**: unchanged. `specs/wire-format/asyncapi.yaml` is a NEW skeleton consolidating Standard Webhooks compliance content (§4.10) into machine-readable form. No `wire-format-delta.yaml` artifact in this change because the wire format itself doesn't change — we are creating its canonical doc, not modifying it.
- **DB schema**: unchanged. `specs/db-schema/0001_init.sql` is a NEW canonical DDL file consolidating §6.1's 6 tables. No `db-schema-delta.sql` artifact in this change because the schema itself doesn't change — we are creating its canonical form.

## Impact

- **Code**: none yet (pre-implementation repo).
- **Docs**: existing `SPECIFICATION.md` is removed; `README.md` is updated; new `VISION.md`, ADRs, capability specs, AsyncAPI doc, SQL DDL are created.
- **Process**: future changes flow through OpenSpec (`openspec new change` → author proposal/specs/language-impact/tasks → apply → archive). Every change MUST include a `language-impact.md` artifact (enforced structurally by the postel-polyglot schema).
- **Stakeholders**: maintainer (you), future contributors (community port authors).
