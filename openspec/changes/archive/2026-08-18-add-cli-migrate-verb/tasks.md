## 1. Author the spec delta

- [x] 1.1 Write `proposal.md`.
- [x] 1.2 `specs/cli/spec.md` — ADD `postel migrate` is the only v1 CLI verb; ADD `postel migrate` brings a database to the current schema version.
- [x] 1.3 `specs/distribution-packaging-typescript/spec.md` — MODIFY `Package map`; MODIFY `Empty placeholder packages are pre-alpha and unpublished`.
- [x] 1.4 `specs/storage-layer/spec.md` — MODIFY `Migrations runnable from CLI and programmatic API` (`ORM schema generation` scenario reworded to the static `/schema` export mechanism).

## 2. Implementation — `@postel/cli`

- [x] 2.1 `typescript/packages/cli/src/migrate.ts` — `runMigrate(argv)`: parse `--dialect` / `--url`, dispatch to `@postel/pg` / `@postel/sqlite` / `@postel/mysql`'s `schemaVersion()` (which runs `autoMigrate` under the hood).
- [x] 2.2 `typescript/packages/cli/src/cli.ts` — `postel` bin entry: only `migrate` is a recognized subcommand; everything else exits non-zero.
- [x] 2.3 `typescript/packages/cli/src/index.ts` — export `runMigrate` for programmatic/test use; drop the `__postelPackage`-only placeholder marker.
- [x] 2.4 `typescript/packages/cli/package.json` — remove `private`; add `bin`; update `description` to name only `migrate`; add `pg` / `better-sqlite3` / `mysql2` and the three standalone adapter workspace deps.
- [x] 2.5 `typescript/packages/cli/tsup.config.ts` — build `index.ts` + `cli.ts`.
- [x] 2.6 `typescript/packages/cli/README.md` — usage docs.

## 3. Implementation — `@postel/drizzle` schema export

- [x] 3.1 `typescript/packages/storage/drizzle/src/schema.ts` — per-dialect (`pg`, `mysql`, `sqlite`) Drizzle table definitions for the canonical schema (`tenants`, `endpoints`, `endpoint_secrets`, `messages`, `attempts`, `endpoint_state_transitions`, `postel_received_messages`).
- [x] 3.2 `typescript/packages/storage/drizzle/package.json` — add the `./schema` export.
- [x] 3.3 `typescript/packages/storage/drizzle/tsup.config.ts` — build `index.ts` + `schema.ts`.

## 4. Tests

- [x] 4.1 `typescript/packages/cli/test/migrate.test.ts` — arg-parsing failures (missing `--dialect`, missing `--url`, unsupported dialect); sqlite fresh-database + rerun-is-a-no-op against a real temp-file database.
- [x] 4.2 `typescript/packages/cli/test/testcontainers-pg.test.ts` — real Postgres (testcontainers, `POSTEL_PG_TESTCONTAINERS`-gated): fresh database reaches the current schema version.
- [x] 4.3 `typescript/packages/cli/test/testcontainers-mysql.test.ts` — real MySQL (`@postel/storage-testkit`'s `startMysqlContainer`, `POSTEL_MYSQL_TESTCONTAINERS`/`POSTEL_MYSQL_URL`-gated): fresh database reaches the current schema version.
- [x] 4.4 `typescript/packages/storage/drizzle/test/schema.test.ts` — the `/schema` export's tables round-trip an insert on a real sqlite Drizzle db (names the `ORM schema generation` scenario).
- [x] 4.5 `typescript/packages/core/test/distribution-packaging.test.ts` — drop `@postel/cli` from the expected placeholder-name list.
- [x] 4.6 `scripts/spec-drift-deferred.txt` — remove the `Migrations runnable from CLI and programmatic API :: ORM schema generation` line.

## 5. CI and docs (rule 8)

- [x] 5.1 `.github/workflows/typescript.yml` — add `@postel/cli` to the `pg-integration` and `mysql-integration` job filter lists.
- [x] 5.2 `docs/content/docs/reference/packages.mdx` — move `@postel/cli` from "Stubs today" to "Available today"; add a `/schema` mention to the `@postel/drizzle` row.
- [x] 5.3 `docs/content/docs/storage/drizzle.mdx` — document the `/schema` export.

## 6. Validation and archive

- [x] 6.1 `openspec validate add-cli-migrate-verb --strict` green.
- [x] 6.2 `openspec archive add-cli-migrate-verb -y`; fill in the real `## Purpose` for the new `cli` spec (archive seeds a TBD placeholder).
- [x] 6.3 `mise run check:all` green.
- [x] 6.4 `pnpm -C typescript --filter @postel/cli --filter @postel/drizzle --filter @postel/core test` green.
