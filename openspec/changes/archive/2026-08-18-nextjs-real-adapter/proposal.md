## Why

Issue #138: `@postel/nextjs` is a 1-line private placeholder while Next.js is the largest TS framework by adoption. The `distribution-packaging-typescript` spec's *Package map* and *Empty placeholder packages are pre-alpha and unpublished* requirement both name `@postel/nextjs` among the pre-alpha placeholder set — that classification is now stale: the package ships a real `NextjsWebAdapter` facade (route-handler bindings over `@postel/http`, per [ADR 0017](../../../decisions/0017-framework-adapter-pattern.md)) and is no longer `private`.

## What Changes

- **distribution-packaging-typescript**
  - MODIFY `Package map` — move `@postel/nextjs` out of the placeholder bullet into the real framework-adapters bullet.
  - MODIFY `Empty placeholder packages are pre-alpha and unpublished` — drop `@postel/nextjs` from the named placeholder set (now four: `@postel/effect`, `@postel/test`, `@postel/bun`, `@postel/cli`); its guard test already detects this dynamically (`isPlaceholder` walks `src/index.ts`), so this is a documentation-accuracy fix, not a behavior change.
  - MODIFY `Framework adapters share a framework-agnostic HTTP core` — the `One error-status policy across adapters` scenario now names Next.js alongside Express/Fastify/Hono/NestJS.

## Capabilities

### Modified Capabilities

- `distribution-packaging-typescript` — two MODIFIED requirements (placeholder-set narrowing, package-map bullet move), one MODIFIED scenario (adapter list).

## Wire-format / DB-schema impact

None. Packaging metadata only.

## Impact

- `typescript/packages/frameworks/nextjs/` — real `NextjsWebAdapter` implementation, tests, `private` removed.
- `typescript/packages/core/test/distribution-packaging.test.ts` — the dynamically-detected placeholder set no longer includes `@postel/nextjs` (asserted by the existing guard test, unchanged logic).
- `docs/content/docs/web-adapters/nextjs.mdx`, `docs/content/docs/web-adapters/index.mdx`, `docs/content/docs/inbound/index.mdx`, `docs/content/docs/reference/packages.mdx` — updated from stub/planned framing to the real adapter (rule 8).
