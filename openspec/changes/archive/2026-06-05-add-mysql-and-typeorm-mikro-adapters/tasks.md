## 1. Spec + ADR

- [ ] 1.1 `storage-layer` ADD *MySQL support across the adapter matrix* (Conformance note); MODIFY *Adapter matrix with three categories* + *Optional storage capabilities*.
- [ ] 1.2 `distribution-packaging-typescript` MODIFY *Package map* (+ `@postel/mysql`, `@postel/typeorm`, `@postel/mikro-orm`; isolation scenario).
- [ ] 1.3 ADR 0007 dated amendment: MySQL Tier-2 → shipped; TypeORM/MikroORM in the ORM row; epoch-millis + one-shared-MySQL-schema rationale.

## 2. storage-helpers

- [ ] 2.1 `MYSQL_MIGRATIONS` (versions 1–4, version-gated, MySQL dialect) in `helpers/src/migrations.ts`.
- [ ] 2.2 `MYSQL_CODEC = { time: "epoch-millis", json: "text" }`, `MYSQL_CAPABILITIES`, `"epoch-millis"` branch in `encodeTimestamp` (`helpers/src/index.ts`).
- [ ] 2.3 MySQL testcontainers factory helper in `@postel/storage-testkit`; update helpers README.

## 3. @postel/mysql (standalone)

- [ ] 3.1 `MysqlStorage` (mysql2/promise; owned pool or connectionString; select-then-update `reserveBatch`; `ON DUPLICATE KEY UPDATE` dedup; backtick idents; `<=>`).
- [ ] 3.2 `MysqlDedup` + `ensureMysqlDedupTable`.
- [ ] 3.3 package.json (`postel.adapter.category = "standalone"`), tsconfig, tsup, README, index.
- [ ] 3.4 Tests: testcontainers-gated `runStorageTests` battery + dedup + category-metadata; docs page.

## 4. Retrofit mysql dialect — drizzle / kysely / prisma

- [ ] 4.1 Widen `dialect` union to include `"mysql"`; MySQL branch (codec, `<=>`, `MYSQL_MIGRATIONS`, select-then-update reservation, `ON DUPLICATE KEY UPDATE` dedup).
- [ ] 4.2 Widen `DrizzleDatabase` union with `MySql2Database`.
- [ ] 4.3 MySQL testcontainers-gated conformance tiers; docs dialect-list updates on the three pages.

## 5. @postel/typeorm (orm)

- [ ] 5.1 `TypeOrmStorage({ dataSource, dialect, clock?, autoMigrate? })` via `dataSource.query` + `dataSource.transaction`; dialect-aware affected-count extraction.
- [ ] 5.2 package.json (`category = "orm"`), tsconfig, tsup, README; tests (better-sqlite3 always-on + mysql gated); docs page.

## 6. @postel/mikro-orm (orm)

- [ ] 6.1 `MikroOrmStorage({ orm | em, dialect, clock?, autoMigrate? })` via `connection.execute(sql, params, 'all' | 'run')` + `connection.transactional`.
- [ ] 6.2 package.json (`category = "orm"`), tsconfig, tsup, README; tests (better-sqlite3 always-on + mysql gated); docs page.

## 7. Docs + packaging finalize + verify + archive

- [ ] 7.1 `reference/packages.mdx`, `storage/index.mdx` matrix, `storage/meta.json`, `is-postel-for-me.mdx` over-claim, landing snippets.
- [ ] 7.2 `pnpm install`; per-package `pnpm --filter @postel/<pkg> test|typecheck|lint|build`.
- [ ] 7.3 `mise run check:all` + `mise run docs:typecheck`.
- [ ] 7.4 `openspec validate add-mysql-and-typeorm-mikro-adapters --strict` then `openspec archive add-mysql-and-typeorm-mikro-adapters -y`.
