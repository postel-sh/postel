## 1. Core types

- [x] 1.1 `storage/types.ts`: add `SecretEncryption` (alias of `KmsStrategy["kind"]`); rename `EndpointSecretRecord.encryptedValue` to `material`; add `EndpointSecretRecord.encryption: SecretEncryption`.
- [x] 1.2 `sender/keys/material.ts`: rename `NewSecretMaterial.encryptedValue` to `material`; add `NewSecretMaterial.encryption: SecretEncryption` set to `'plaintext'` (the only strategy the fail-fast gate in `outbound.ts` currently allows through construction).
- [x] 1.3 `sender/keys/rotation.ts`, `sender/endpoint/crud.ts`, `sender/dispatcher/headers.ts`: rename `.encryptedValue` reads/writes to `.material`; pass through `.encryption`.

## 2. Storage adapters

- [x] 2.1 `storage/memory/adapter.ts`: bump `SCHEMA_VERSION` to `7`; rename the in-memory field and default `encryption` to `'plaintext'`.
- [x] 2.2 `storage/helpers/src/index.ts`: `encodeSecretInsert` / `decodeSecret` — rename `encrypted_value` column to `material`; encode/decode the new `encryption` column.
- [x] 2.3 `storage/helpers/src/migrations.ts`: add a version-7 entry to `SQLITE_MIGRATIONS`, `PG_MIGRATIONS`, and `MYSQL_MIGRATIONS` — `RENAME COLUMN encrypted_value TO material` plus `ADD COLUMN encryption ... NOT NULL DEFAULT 'plaintext'`.
- [x] 2.4 `storage/sqlite/src/storage.ts`: update the hand-written `INSERT INTO endpoint_secrets` column list from `encrypted_value` to `material, encryption`.
- [x] 2.5 Other 7 SQL adapters (`pg`, `mysql`, `kysely`, `drizzle`, `typeorm`, `prisma`, `mikro-orm`): no code changes — they route through `encodeSecretInsert` / `decodeSecret` and `select *`.

## 3. DB schema

- [x] 3.1 Add `specs/db-schema/0007_endpoint_secret_material_column.sql` (rename + new column + schema_version bump).
- [x] 3.2 Update `specs/db-schema/0001_init.sql`'s `endpoint_secrets` comment/column name for future readers (the canonical DDL narrative, not a second migration).

## 4. Tests

- [x] 4.1 `core/test/keys-replay.test.ts`, `core/test/jwks-publish.test.ts`, `core/test/dispatcher.test.ts`, `core/test/retry.test.ts`, `core/test/review-fixes.test.ts`, `core/test/config-audit.test.ts`: rename `encryptedValue` fixtures/assertions to `material` (+ `encryption` where a full record is constructed).
- [x] 4.2 `storage/helpers/test/helpers.test.ts`: update `encodeSecretInsert` / `decodeSecret` round-trip assertions for `material` / `encryption`.
- [x] 4.3 `core/test/storage.test.ts`: update the schema-version assertion to `7`.
- [x] 4.4 `storage/testkit/src/index.ts`: update the shared conformance battery's secret fixtures/assertions to `material` / `encryption`, run against every adapter's suite.

## 5. Docs

- [x] 5.1 `docs/content/docs/outbound/index.mdx`: security note on what is stored at rest until KMS lands (done inline with this change).

## 6. Verification

- [x] 6.1 Run `mise run check:all` at the repo root.
- [x] 6.2 Run the `@postel/core` and `@postel/storage-helpers` test/lint/typecheck/build chains, plus every storage-adapter package touched.
