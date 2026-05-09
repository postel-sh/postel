# Tasks — setup agentic development workflow

## 1. Agent-facing rules

- [x] 1.1 Write `CLAUDE.md` at the repo root with: project framing, source-of-truth pointers, workflow rules (spec is truth, tests = scenarios, OpenSpec for spec changes, verification chain), the per-capability implementation loop, what NOT to do, useful commands.

## 2. Permissions

- [x] 2.1 Write `.claude/settings.json` with a conservative permission allowlist for read-only and dev-loop commands. Destructive operations remain prompt-gated.

## 3. Spec-drift detector

- [x] 3.1 Write `scripts/check-spec-drift.mjs` — Node ESM script, no deps. Walks `openspec/specs/<cap>/spec.md`, extracts `### Requirement:` titles, walks `packages/*/test/**/*.test.{ts,js,mjs,tsx}`, fails if any requirement title isn't named in any test file. Emits informational no-op when no test files exist yet.

## 4. CI workflow

- [x] 4.1 Write `.github/workflows/ci.yml` with two jobs:
  - `spec`: validates OpenSpec (`openspec validate --all`), the custom schema, and runs `check:spec-drift`.
  - `build`: typecheck / lint / test / bundle-size / compliance, all `--if-present` so the workflow is green today and gradually activates as scripts land.

## 5. package.json

- [x] 5.1 Add npm scripts: `spec:validate`, `spec:check-drift`, `check:spec-drift` (the last is what CI calls; the first two are aliases for human use).

## 6. Verification

- [x] 6.1 Run `npm run check:spec-drift` locally — expect informational no-op (no `packages/` yet). ✓ Output: "110 requirement(s) waiting for tests; no test files exist yet."
- [x] 6.2 Run `npx openspec validate --all` — expect green. ✓ 14 passed.
- [x] 6.3 Run `npx openspec validate setup-agentic-dev-workflow` — expect green. ✓

## 7. Archive

- [x] 7.1 Run `npx openspec archive setup-agentic-dev-workflow -y`. Upstream OpenSpec moves the change to archive and applies the delta to `openspec/specs/distribution-packaging/spec.md`.
