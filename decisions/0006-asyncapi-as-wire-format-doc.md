# 0006 — AsyncAPI 3.0 as the canonical wire-format doc

- **Status**: accepted
- **Date**: 2026-05-09
- **Decision drivers**: polyglot codegen target, machine-readable wire format, ecosystem fit

## Context

The wire format (Standard Webhooks-compliant headers, signature versions, payload structure) is the most stable and codegen-friendly part of Postel's surface. Future language ports need a machine-readable artifact they can codegen types and serialization from. Capability markdown specs are not that artifact — they are normative for behavior, not for byte-level format.

The candidate IDLs are:

- **AsyncAPI 3.0** — purpose-built for event-driven and webhook systems; covers headers, payload schemas, security schemes; ecosystem of codegen tools across many languages.
- **OpenAPI (Swagger)** — designed for HTTP request/response APIs; can describe webhook endpoints but is awkward for event payload modeling.
- **Protocol Buffers** — strong for binary protocols, less natural for JSON over HTTP, no first-class header modeling.
- **JSON Schema alone** — covers payload shape, doesn't cover delivery semantics or headers.

## Decision

Use **AsyncAPI 3.0** as the canonical, machine-readable wire-format spec. The document lives at `specs/wire-format/asyncapi.yaml` and is the source of truth for byte-level wire details (header set, signature versions, payload shape, secret prefixes).

Operational behavior (retry policy, fanout, circuit breaker, replay) does NOT live in AsyncAPI. It lives in the relevant capability spec under `openspec/specs/<capability>/spec.md`. This split is non-negotiable: AsyncAPI models communication, not orchestration.

## Consequences

- Community port authors can run AsyncAPI codegen tools to produce typed event/header bindings in their target language.
- The compliance suite can be wired to validate wire-format claims against the AsyncAPI doc in CI.
- Spec extension proposals to Standard Webhooks (versioning, JWKS, IETF alignment) include the corresponding AsyncAPI fragments as the reference implementation.
- We do not stretch AsyncAPI to cover behavior. If a future feature blurs the wire/behavior line, we err on the side of duplicating the salient bits in markdown rather than overloading AsyncAPI.

## Alternatives considered

- **OpenAPI** — rejected. Awkward fit for event-driven payloads; ecosystem is HTTP-RPC-shaped.
- **Protocol Buffers** — rejected. Wrong shape for JSON-over-HTTP webhooks.
- **Markdown only** — rejected. Forecloses codegen for ports.
- **JSON Schema only** — partially adopted: AsyncAPI uses JSON Schema for payloads internally.
