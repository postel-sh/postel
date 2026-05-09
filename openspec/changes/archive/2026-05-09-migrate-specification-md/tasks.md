# Tasks — migrate SPECIFICATION.md to capability-based specs

## 1. Top-level docs

- [x] 1.1 Write `VISION.md` at the repo root with corrected positioning (spec-first, TS reference impl, polyglot follows). Carry forward §1, §2, §3.1, §3.3, §10 (adoption goals), §11 (operational principles), §12 (success criteria) from `SPECIFICATION.md`. Rewrite §1.2 and §3.2.
- [x] 1.2 Create `CHANGELOG.md` stub (Keep-a-Changelog format, "Unreleased" section).
- [x] 1.3 Update `README.md`: replace any "Specification" link with pointers to `VISION.md`, `openspec/specs/`, `specs/`, and `decisions/`. Reflect the spec-first positioning.

## 2. Architecture decisions

- [x] 2.1 Write `decisions/0001-library-not-service.md` (drawn from §1.4 non-goals, §11, §7 AR-1).
- [x] 2.2 Write `decisions/0002-no-redis-no-broker.md` (§1.4, §5.4 NFR-C-5, AR-9).
- [x] 2.3 Write `decisions/0003-code-first-config.md` (§7 AR-2).
- [x] 2.4 Write `decisions/0004-postgres-and-sqlite-only.md` (§5.4 NFR-C-3/4, §6.2 SR-1/2).
- [x] 2.5 Write `decisions/0005-openspec-as-spine.md` recording the SDD framework choice and the upstream OpenSpec selection.
- [x] 2.6 Write `decisions/0006-asyncapi-as-wire-format-doc.md` recording the choice of AsyncAPI 3.0 for the canonical wire format spec.
- [x] 2.7 Write `decisions/0007-polyglot-staged-rollout.md` recording the §3.2 reversal and the staged port roadmap (TS first, Go receiver next, gated on `@postel/compliance`).

## 3. Canonical machine-readable artifacts

- [x] 3.1 Write `specs/wire-format/asyncapi.yaml` — AsyncAPI 3.0 skeleton consolidating Standard Webhooks compliance content from §4.10.
- [x] 3.2 Write `specs/wire-format/README.md` pointing at the AsyncAPI doc and explaining its scope (wire format only — operational behavior lives in capability specs).
- [x] 3.3 Write `specs/db-schema/0001_init.sql` — canonical DDL for the 6 tables in §6.1 (Postgres dialect with SQLite variants commented inline).
- [x] 3.4 Write `specs/db-schema/README.md` explaining the migration numbering convention.
- [x] 3.5 Write `specs/compliance/README.md` pointing at the future `@postel/compliance` package.

## 4. Remove the monolithic spec

- [x] 4.1 Delete `SPECIFICATION.md` from the repo root.

## 5. Archive

- [x] 5.1 Run `npx openspec archive migrate-specification-md -y` to archive the change. Upstream OpenSpec will move the change folder under `openspec/changes/archive/` and populate `openspec/specs/<capability>/spec.md` from the delta specs.
- [x] 5.2 Verify `npx openspec list --specs` lists all 13 capabilities with the populated content.
- [x] 5.3 Verify `npx openspec validate` passes across all main specs and the archived change.
