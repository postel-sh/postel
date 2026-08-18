## Why

`mintSecretMaterial` TextEncoder-encodes the raw HMAC secret or Ed25519 private key straight into a column named `encrypted_value` (`typescript/packages/core/src/sender/keys/material.ts:19-25`). No encryption exists — the KMS adapter is deferred behind a fail-fast config slot (`scripts/spec-drift-deferred.txt:68`). The name actively misleads adopters into believing at-rest encryption is on; a DB dump exposes every signing key in plaintext. This is a canonical-DB-schema and cross-port CONTRACT change, so it must land pre-1.0 (breaking-if-deferred).

## What Changes

- **`endpoint_secrets.encrypted_value` renamed to `endpoint_secrets.material`** across the canonical schema, all three `@postel/storage-helpers` migration dialects, and the SQLite standalone adapter's hand-written column list.
- **New `endpoint_secrets.encryption` discriminator column** (`text NOT NULL DEFAULT 'plaintext'`), reusing the existing `KmsStrategy["kind"]` vocabulary (`'plaintext' | 'aws-kms' | 'gcp-kms' | 'vault'`). Every row written today is `'plaintext'` — the only strategy the fail-fast gate in `outbound.ts` currently allows through construction. This is the landing zone a future KMS path populates per-row once envelope encryption ships.
- **`NewSecretMaterial.encryptedValue` / `EndpointSecretRecord.encryptedValue` renamed to `material`**; `EndpointSecretRecord` gains `encryption: SecretEncryption` (alias for `KmsStrategy["kind"]`).
- **BREAKING**: any host reading `endpoint_secrets` rows directly, or importing `EndpointSecretRecord`/`NewSecretMaterial` and touching `.encryptedValue`, must rename to `.material` and account for the new `.encryption` column.
- **Docs security note**: state plainly, next to the KMS docs, what is actually stored at rest until KMS lands (plaintext key material, discriminated by `encryption: 'plaintext'`).
- KMS itself stays deferred and fail-fast — no behavior change there.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `key-management`: MODIFIED "Encryption at rest with KMS adapter" — the stored column is now honestly named (`material`, not `encrypted_value`) and carries a per-row `encryption` discriminator that documents what protection (if any) was applied, giving the future KMS adapter a landing zone instead of a column name that already claims encryption happened.

## Wire-format / DB-schema impact

Wire-format: unchanged (secret material is never carried on the wire). DB-schema: `endpoint_secrets.encrypted_value` is renamed to `material`, and a new `encryption` column is added (`NOT NULL DEFAULT 'plaintext'`). `_postel_meta.schema_version` bumps for the next-numbered migration.

## Impact

- `@postel/core`: `storage/types.ts` (`EndpointSecretRecord`, new `SecretEncryption` type), `sender/keys/material.ts` (`NewSecretMaterial`, `mintSecretMaterial`), `sender/keys/rotation.ts`, `sender/endpoint/crud.ts`, `sender/dispatcher/headers.ts`, `storage/memory/adapter.ts` (`SCHEMA_VERSION` bump).
- `@postel/storage-helpers`: `src/index.ts` (`encodeSecretInsert` / `decodeSecret`), `src/migrations.ts` (new version-7 entry in `SQLITE_MIGRATIONS` / `PG_MIGRATIONS` / `MYSQL_MIGRATIONS` renaming the column and adding `encryption`).
- `@postel/sqlite`: `src/storage.ts` hand-written insert column list.
- Other 7 SQL storage adapters (`pg`, `mysql`, `kysely`, `drizzle`, `typeorm`, `prisma`, `mikro-orm`): no code changes — they route entirely through `encodeSecretInsert` / `decodeSecret` and `select *`, so the widened `Storage`/`EndpointSecretRecord` type flows through generically; `storage/testkit` conformance battery covers the renamed field/column end-to-end on every adapter.
- `specs/db-schema/`: new `0007_endpoint_secret_material_column.sql` migration; `0001_init.sql` comment updated for future readers.
- Docs: `docs/content/docs/outbound/keys.mdx` (or nearest key-management page) gains a security note on what is stored at rest until KMS lands.
