# Proposal — setup agentic development workflow

## Why

Postel's bet is that capability specs + a compliance suite together form an unambiguous contract that an agentic coding AI (Claude Code, or any equivalent) can implement against without manual intervention. The spec gives the agent a target; the compliance suite tells the agent (unambiguously) when it's done.

That bet only pays off if the surrounding scaffolding exists: an agent-facing rules file, a permission allowlist so the loop runs without confirmation prompts, CI gates that catch drift before merge, and a spec-test traceability check so requirements can't be silently dropped. None of that exists yet.

## What Changes

- **NEW**: `CLAUDE.md` at the repo root — agent-facing house rules: spec is source of truth, scenarios = tests, OpenSpec workflow for spec changes, verification chain before commit, what NOT to do.
- **NEW**: `.claude/settings.json` — conservative permission allowlist for read-only and dev-loop commands (`npm run *`, `npx openspec *`, `node scripts/*`, read-only git/gh). Destructive operations (`git push`, `gh pr create`, `npm publish`) deliberately NOT auto-allowed.
- **NEW**: `scripts/check-spec-drift.mjs` — Node script that walks `openspec/specs/<cap>/spec.md`, extracts every `### Requirement:`, and verifies the requirement name appears as a string in at least one test file. Exits 1 if drift detected. No-op when `packages/` is empty (current state) so it doesn't block work pre-implementation.
- **NEW**: `.github/workflows/ci.yml` — GitHub Actions workflow with two jobs: `spec` (validates OpenSpec + schema + spec-drift) and `build` (typecheck/lint/test/bundle-size/compliance, all `--if-present` so they activate as scripts land).
- **MODIFIED**: `package.json` — add `spec:validate`, `spec:check-drift`, and `check:spec-drift` script entries. Other scripts (`test`, `typecheck`, `lint`, `check:size`, `test:compliance`) added as the corresponding tooling lands in future changes.
- **NEW REQUIREMENT** (delta spec): under `distribution-packaging`, a "Spec-test traceability" requirement — every `### Requirement` in `openspec/specs/` MUST have at least one test that names it. Enforced by `scripts/check-spec-drift.mjs` in CI.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `distribution-packaging` — adds one ADDED requirement: spec-test traceability is a CI gate.

## Wire-format / DB-schema impact

- **Wire format**: unchanged. No `wire-format-delta.yaml`.
- **DB schema**: unchanged. No `db-schema-delta.sql`.

## Impact

- **Code**: none yet (still pre-implementation). Scripts and CI scaffolding are ready for the first capability implementation.
- **Process**: future implementation work runs the loop documented in `CLAUDE.md` (read spec → tests-from-scenarios → minimal code → verification chain → PR). Spec-test drift is a CI gate from this point forward.
- **Stakeholders**: maintainer (you) and any agent (Claude or otherwise) that will sit in front of this repo.
