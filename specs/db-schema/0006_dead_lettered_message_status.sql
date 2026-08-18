-- Postel canonical DB schema — migration 0006 (dead-lettered message status).
--
-- Dialect: Postgres >= 14. SQLite >= 3.40 variants noted inline as
-- `-- SQLite:` comments.
--
-- No column or table DDL: `messages.status` is (and remains) a free-text
-- column with no CHECK constraint, so the new `dead-lettered` value needs no
-- ALTER. This migration exists to bump the canonical schema version and
-- record the vocabulary change for the cross-port contract:
--   messages.status: pending | dispatched | dead-lettered | expired
-- (was: pending | dispatched | expired).
-- Forward-only and idempotent.

INSERT INTO _postel_meta (key, value)
VALUES ('schema_version', '6')
ON CONFLICT (key) DO UPDATE SET value = '6';
