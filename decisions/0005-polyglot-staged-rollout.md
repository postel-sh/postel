# 0005 — Polyglot staged rollout (TypeScript first, then Go, Python, Rust)

- **Status**: accepted
- **Date**: 2026-05-09
- **Decision drivers**: corrected positioning (polyglot, not "TS-first"), reach across stacks, sustainable maintenance

## Context

The original `SPECIFICATION.md` (now removed) declared:

- §1.2 "TypeScript-first webhooks library"
- §3.2 "Maintained ports in Go / Python / Rust / Ruby / etc. — out of scope. Wire format and DB schema are documented and stable; community ports are welcome but unowned."

That positioning is wrong for the project we are actually building. A library whose value proposition is "one delivery layer, every stack" cannot truly own its ecosystem if the only first-class implementation is in TypeScript. Receivers in Go, Python, Rust, and Ruby are common in the same B2B SaaS deployments that are our primary persona; if Postel does not commit to maintained ports, integration teams hand-roll signature verification — and we lose them at the first non-TS hop.

## Decision

Postel is a **polyglot** webhooks library backed by solid, executable specs. The TypeScript implementation in this repo ships first; Go, Python, and Rust follow as first-class ports, not unsupported community efforts. Every port conforms to the same wire format, DB schema, and capability behaviors, verified by `@postel/compliance`.

### The port roadmap

1. **TypeScript** (this repo, ships first) — sender + receiver. Must pass `@postel/compliance` end-to-end. 1.0 ship gate.
2. **Go receiver** — receiver-only for the first cut. Tracks Go's strong adoption in serverless / API gateway tiers.
3. **Python receiver** — receiver-only. Common in data-processing / ML stacks.
4. **Rust** — sender + receiver. Edge runtime relevance and the ecosystem's correctness culture.
5. **Senders in Go / Python** — added once the receivers are stable and there is documented demand.

Order is not contractual; it is the current best estimate of where adoption is highest. Each port is added via an OpenSpec change that:

- Introduces a capability `api-surface-<lang>` (e.g., `api-surface-go`).
- Includes a `language-impact.md` artifact declaring which other ports must change in lockstep.
- Demonstrates passing `@postel/compliance` before merge.

### What "first-class" means

- Lives in this repo (or a sibling repo under the same org with the same ownership).
- Is released on the same major-version cadence as TypeScript packages.
- Is included in the published benchmark suite where applicable.
- Carries equal weight in the roadmap and breaking-change discussions.

### What "first-class" does NOT mean

- That every port reaches feature parity at the same time. TypeScript ships first and leads on feature completeness; other ports may track behind for a release cycle or two.
- That every port supports every persona (e.g., the Go receiver may not have an Effect-TS layer).
- That the maintainer team grows linearly with the port count. Single-vendor governance with clear contribution guidelines remains the model.

## Consequences

- §1.2 of `VISION.md` reads "polyglot webhooks library backed by solid, executable specs; TypeScript ships first; Go, Python, Rust follow."
- §3.2's "out of scope" list no longer includes maintained ports.
- The OpenSpec `postel` schema requires a `language-impact.md` artifact on every change so the polyglot dimension is structurally enforced.
- The compliance test suite (`@postel/compliance`) is the contract every port must satisfy. Without it, "polyglot" is hand-waving; with it, "polyglot" is verifiable.
- Resourcing for non-TS ports is a project-management concern, not a spec concern. The spec is ready when this change is merged; staffing is tracked separately.

## Alternatives considered

- **Stay TypeScript-only, document community ports** (the original §3.2 stance) — rejected. The receiver story for non-Node stacks is too important to leave to community efforts.
- **Codegen all ports from a single IDL** (Smithy / Speakeasy / Stainless style) — rejected. Postel's surface includes operational behavior that does not codegen well; the wire format codegens (via AsyncAPI), but worker logic, retry policy, and replay must be hand-written per language.
- **Federated repos, one per language** — deferred. A monorepo is simpler at v0; if maintenance pressure justifies it later, splitting per-language is a mechanical move.
