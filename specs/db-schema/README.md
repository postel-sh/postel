# DB schema

Canonical, forward-only DDL for Postel's persistence layer.

## Files

Migrations are numbered sequentially with a 4-digit prefix and a kebab-case slug:

```
0001_init.sql
0002_<slug>.sql
0003_<slug>.sql
...
```

The first file (`0001_init.sql`) defines the canonical baseline — all six tables (`tenants`, `endpoints`, `endpoint_secrets`, `messages`, `attempts`, `endpoint_state_transitions`) plus the `dead_letter` view, plus the `_postel_meta` schema version table.

## Dialects

Files target Postgres ≥ 14 as the primary dialect. SQLite ≥ 3.40 differences are commented inline as `-- SQLite:` lines next to the affected column or table. Other RDBMSes are supported via the BYO `Storage` interface (see [`openspec/specs/storage-layer/spec.md`](../../openspec/specs/storage-layer/spec.md)).

## Conventions

- **Forward-only.** No DROP/ALTER that loses data. Schema removal is a soft transition: deprecate, leave in place for the next major version, then remove in a subsequent migration.
- **Idempotent.** Migrations use `IF NOT EXISTS` and `ON CONFLICT` so they can be invoked on every boot.
- **Tenant-scoped.** Every persistent row has a `tenant_id` column. Single-tenant deployments use `NULL`.
- **`_postel_meta` records the schema version.** The library refuses to run against an incompatible schema; CI verifies the current schema version matches the library version.

## Updating

Schema changes flow through OpenSpec. A change that modifies the schema MUST attach a `db-schema-delta.sql` artifact (forward-only DDL fragment). On archive, the fragment is moved here as the next-numbered migration file.
