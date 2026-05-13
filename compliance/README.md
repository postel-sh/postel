# @postel/compliance

> Standard Webhooks compliance test suite (CLI) — the executable conformance boundary.

This package is part of [Postel](https://github.com/postel-sh/postel), a polyglot webhooks library backed by solid, executable specs. The TypeScript implementation ships first; Go, Python, and Rust follow. Every port conforms to the same wire format, DB schema, and capability behaviors — verified by this test suite.

It lives at the repo root rather than inside `typescript/packages/` because it is a **shared cross-language asset**: invoked by every port's CI, language-agnostic in contract, with the first runner implementation in TypeScript. See [ADR 0006 — Polyglot monorepo layout](../decisions/0006-monorepo-layout.md) and [ADR 0009 — Compliance suite evolution policy](../decisions/0009-compliance-suite-evolution.md) for the rationale.

Status: **0.0.0** — scaffolded. No code yet. See the [distribution-packaging-typescript capability spec](../openspec/specs/distribution-packaging-typescript/spec.md) for the full package map and the per-capability implementation specs under [`openspec/specs/`](../openspec/specs/).

## License

MIT
