# 0003 — OpenSpec as the SDD spine

- **Status**: accepted
- **Date**: 2026-05-09
- **Decision drivers**: polyglot ambition, shared executable specs, RFC-style change process, lightweight→strict escalation

## Context

Postel is positioned as a polyglot library for sending and receiving webhooks reliably and securely. Multiple language implementations over time — TypeScript first, then Go, Python, and Rust — all conforming to the same wire format, DB schema, and capability behaviors. This requires:

1. A **change process** that resembles an RFC: every change to the spec is reviewable as a discrete artifact with a proposal, requirements, and tasks.
2. **Canonical specs** organized by capability, not by document, so contributors and port authors can read "what does the receiver do?" without paging through 12 sections.
3. **Lightweight at v0**, with a clean path to **stricter ceremony** as the project matures — without re-platforming or rewriting prior changes.
4. **Polyglot enforcement**: every change must declare which language ports it affects.

We considered three families of approach:

- **Plain-markdown RFC** in the style of Rust/React/Python PEPs. Simple, no tooling, but no structural enforcement and no automated archive lineage.
- **Heavy IDL** (Smithy, Protocol Buffers + RPC). Generates SDKs across languages but is shaped for service definitions, not libraries with operational semantics. Overkill for our wire format (Standard Webhooks already specifies it) and unhelpful for behavior (retries, fanout, circuit breaking).
- **OpenSpec** ([@fission-ai/openspec](https://github.com/Fission-AI/OpenSpec), MIT, generic and stack-agnostic). Provides change folders (`proposal.md`, `specs/`, `design.md`, `tasks.md`), an archive workflow that merges deltas into main specs, and a custom-schema mechanism that lets us tighten ceremony over time.

## Decision

Use upstream OpenSpec as the SDD spine. Fork its built-in `spec-driven` schema as `postel` to add three Postel-specific artifacts:

- `language-impact.md` (REQUIRED on every change) — the polyglot enforcement point. A change cannot be archived without declaring which language ports are affected.
- `wire-format-delta.yaml` (OPTIONAL) — AsyncAPI 3.0 fragments for changes that modify the wire format.
- `db-schema-delta.sql` (OPTIONAL) — forward-only DDL for changes that modify the canonical schema.

`design.md` becomes truly optional at v0; it will be promoted to required at v1 via a schema fork (`postel-v1`) without affecting prior v0 changes.

OpenSpec lives alongside three canonical artifact stores that it does not own: `specs/wire-format/asyncapi.yaml`, `specs/db-schema/*.sql`, and `decisions/*.md` (ADRs). OpenSpec is the change spine; those are the codegen and decision-record targets.

## Consequences

- Every change to the spec is a reviewable folder with a stable on-disk shape.
- The polyglot dimension is structurally enforced, not an editor-driven discipline.
- OpenSpec's `archive` command auto-merges deltas into `openspec/specs/<capability>/spec.md` so the canonical specs stay current without manual sync.
- Custom schemas mean we can tighten the workflow (mandatory design doc, compliance-impact section, community review gate) over time without rewriting prior changes.
- We carry a dependency on a relatively young upstream tool (`@fission-ai/openspec` v1.x). If the dependency proves unsuitable, the on-disk content (capability specs as markdown, ADRs, AsyncAPI, SQL DDL) is portable to a plain-markdown setup with modest effort.

## Alternatives considered

- **Plain markdown RFCs (Rust/React style)** — rejected for v0 (no archive lineage, no structural polyglot enforcement) but retained as the documented fallback.
- **Smithy / Protocol Buffers** — rejected. Strong for service IDLs and SDK codegen, weak for operational semantics. Our codegen target is the wire format only, which AsyncAPI already covers.
- **AsyncAPI as the single source of truth** — rejected. AsyncAPI does not model retry, fanout, circuit-breaker, or replay behavior. Those need markdown specs.
- **Rolling our own framework** — rejected. The bespoke value is in the spec content, not the process plumbing.
