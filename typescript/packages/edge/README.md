# @postel/edge

> Postel receiver + JWKS consumer for edge runtimes (Cloudflare Workers, Vercel Edge, Deno Deploy).

This package is part of [Postel](https://github.com/postel-sh/postel), a polyglot webhooks library backed by solid, executable specs. The TypeScript implementation ships first; Go, Python, and Rust follow. Every port conforms to the same wire format, DB schema, and capability behaviors — verified by the `@postel/compliance` test suite.

Status: **0.0.0** — public API is scaffolded; runtime behavior lands across the v0.1.0 PR series. See the [receiver capability spec](../../../openspec/specs/receiver/spec.md) for the contract, and [`openspec/specs/compliance/spec.md`](../../../openspec/specs/compliance/spec.md) for the v0.1.0 corpus.

## Constraints

- **Edge-only runtime surface.** Imports Web APIs only (`fetch`, `crypto.subtle`, `TextEncoder`, …). No `node:*` imports. The bundle is built with esbuild `platform: "neutral"`, so a leaked Node import surfaces as a hard build failure rather than a silent externalization.
- **Bundle budget.** ≤ 50 KB minified+gzipped. Enforced in CI by [`scripts/check-edge-bundle.mjs`](../../../scripts/check-edge-bundle.mjs), per the receiver spec's "Edge bundle size budget" requirement.

## Public API (scaffolded)

```ts
import {
  verify,
  createKeyset,
  jwksHandler,
  dedup,
  signFixture,
  SignatureInvalid,
  TimestampTooOld,
  MalformedHeader,
  UnknownKeyId,
  RawBytesMismatchDetected,
} from "@postel/edge";
```

All entry points throw `Not implemented in the v0.1.0 skeleton` at runtime until the implementation PRs land. Types are stable from this PR forward; consumers can wire imports against them now.

## License

MIT
