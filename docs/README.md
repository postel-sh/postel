## `@postel/docs-site`

Postel's documentation website. [Fumadocs](https://fumadocs.dev) on Next.js, MDX content, Tailwind v4.

**Not part of the `@postel/*` release train.** This is a project artifact (like `compliance/`), not a published package. It lives at the repo root per [ADR 0006](../decisions/0006-monorepo-layout.md): top-level for cross-cutting assets, language-scoped tooling stays inside each language directory.

### Local dev

```bash
cd docs
pnpm install
pnpm dev      # → http://localhost:3000
pnpm build    # production build
```

Or via mise from the repo root:

```bash
mise run docs:dev
mise run docs:build
```

### Layout

```
docs/
├── app/                    Next.js app router
│   ├── (home)/             Landing layout + page
│   ├── docs/               DocsLayout + dynamic [[...slug]] route
│   └── api/search/         Fumadocs search route
├── content/docs/           MDX content (rendered into the docs route)
├── lib/                    source loader + shared layout config
├── source.config.ts        Fumadocs MDX collections
├── next.config.mjs         wraps Next with createMDX
└── package.json
```

### What ships here vs. what doesn't

This PR scaffolds the site so future PRs can author content. **No spec / API / ADR content is rendered yet.** Follow-up PRs land:

1. An `openspec/specs/<cap>/spec.md` → `content/docs/reference/capabilities/<cap>.mdx` sync script at build time.
2. The same for ADRs and the AsyncAPI / SQL DDL specs.
3. An implementation-status badge component driven from [`scripts/spec-drift-deferred.txt`](../scripts/spec-drift-deferred.txt).
4. A `compliance/vectors/**` → corpus index page.
5. TypeDoc-generated API reference for `@postel/edge` (and other packages as they ship).
