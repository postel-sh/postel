## Why

Issue #148: `@postel/cli` is a 1-line placeholder whose package description promises five verbs (migrate, sign, verify, replay, simulate) — none spec'd anywhere. The `storage-layer` spec meanwhile mandates migrations runnable "via a CLI (`mise run postel:migrate` or equivalent)", and `@postel/drizzle` does not export the `/schema` fragment the same spec already names. Per workflow rule 1, spec before code.

## What Changes

- **cli** (new capability)
  - ADD `postel migrate` — the only verb the v1 CLI ships. Takes `--dialect <postgres|sqlite|mysql>` and `--url <connection-string>`, runs the matching standalone adapter's canonical migrations, and exits 0 once the database is at the current schema version. Idempotent on rerun.
  - The other four advertised verbs (`sign`, `verify`, `replay`, `simulate`) stay unspec'd and unimplemented until a future change demands them — the CLI binary refuses any command other than `migrate`.
- **distribution-packaging-typescript**
  - MODIFY `Package map` — move `@postel/cli` out of the placeholder bullet into a real "CLI" bullet describing the shipped `migrate` verb.
  - MODIFY `Empty placeholder packages are pre-alpha and unpublished` — drop `@postel/cli` from the named placeholder set (now three: `@postel/effect`, `@postel/test`, `@postel/bun`); its guard test already detects this dynamically (`isPlaceholder` walks `src/index.ts`), so this is a documentation-accuracy fix, not a behavior change.
- **storage-layer**
  - MODIFY `Migrations runnable from CLI and programmatic API` — the `ORM schema generation` scenario described a `postel schema generate drizzle` CLI command that this change does not build; the actual mechanism is a static `@postel/drizzle/schema` export the host imports directly (dialect-appropriate Drizzle table definitions for the canonical schema, no CLI generator step). Reword the scenario to match the delivered mechanism.

## Capabilities

### Added Capabilities

- `cli` — one requirement (`postel migrate` verb), three scenarios (fresh database reaches current version, missing required flag fails fast, unsupported dialect fails fast).

### Modified Capabilities

- `distribution-packaging-typescript` — two MODIFIED requirements (package-map bullet move, placeholder-set narrowing).
- `storage-layer` — one MODIFIED scenario (`ORM schema generation` now describes the static schema export instead of a CLI generator).

## Wire-format / DB-schema impact

None. `postel migrate` runs the existing canonical migrations verbatim through the existing standalone adapters (`@postel/pg`, `@postel/sqlite`, `@postel/mysql`); no new migration or schema version is introduced. The `@postel/drizzle/schema` export mirrors the existing canonical column shapes in Drizzle's DSL.

## Impact

- `typescript/packages/cli/` — real `postel migrate` binary + programmatic `runMigrate`, tests on pg (pglite-incompatible — real Postgres via testcontainers)/sqlite/mysql, `private` removed, description updated.
- `typescript/packages/storage/drizzle/` — new `/schema` subpath export (Drizzle table definitions per dialect), tests.
- `typescript/packages/core/test/distribution-packaging.test.ts` — the dynamically-detected placeholder set no longer includes `@postel/cli` (asserted by the existing guard test, unchanged logic).
- `scripts/spec-drift-deferred.txt` — remove the `Migrations runnable from CLI and programmatic API :: ORM schema generation` deferral now that it has a real test.
- `.github/workflows/typescript.yml` — add `@postel/cli` to the `pg-integration` and `mysql-integration` jobs' filter lists.
- `docs/content/docs/reference/packages.mdx`, `docs/content/docs/storage/drizzle.mdx` — updated from stub/planned framing to the real `migrate` verb and the `/schema` export (rule 8).
