-- Postel canonical DB schema — migration 0005 (endpoints structural filter).
--
-- Dialect: Postgres >= 14. SQLite >= 3.40 variants noted inline as
-- `-- SQLite:` comments.
--
-- Adds the persisted structural filter column. The old `filter` field was a
-- code-side predicate function held only in a process-local registry (never
-- a DB column); the new `filter` is a JSON-serializable structural clause
-- (or array of clauses) and is a real, round-tripping column. The renamed
-- function escape hatch (`filterFn`) keeps the old code-side-only behavior
-- and stays out of the DB, same as `transform`.
-- Forward-only and idempotent.

ALTER TABLE endpoints
  ADD COLUMN IF NOT EXISTS filter jsonb;  -- SQLite: filter TEXT (JSON)

INSERT INTO _postel_meta (key, value)
VALUES ('schema_version', '5')
ON CONFLICT (key) DO UPDATE SET value = '5';
