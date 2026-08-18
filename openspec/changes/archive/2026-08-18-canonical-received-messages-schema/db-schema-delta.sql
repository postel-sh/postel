-- Postel canonical DB schema — migration 0007 (received messages dedup table).
--
-- Dialect: Postgres >= 14. SQLite >= 3.40 variants noted inline as
-- `-- SQLite:` comments; MySQL >= 8.0 variants as `-- MySQL:` comments.
--
-- Canonical shape for postel_received_messages: the receiver-side idempotency
-- dedup table every first-party adapter (in-memory, Postgres, SQLite, MySQL)
-- has implemented ad hoc since inception, with no normative schema until now
-- (polyglot contract hole, #132). This migration documents the shape those
-- adapters already converge on. Unlike every other table in this schema, it
-- intentionally has no tenant_id: message ids are deduplicated in a single
-- global namespace.
-- Forward-only and idempotent.

CREATE TABLE IF NOT EXISTS postel_received_messages (
  message_id  text PRIMARY KEY,      -- SQLite: TEXT; MySQL: VARCHAR(191)
  expires_at  timestamptz NOT NULL   -- SQLite: INTEGER (epoch-ms); MySQL: BIGINT (epoch-ms)
);

CREATE INDEX IF NOT EXISTS postel_received_messages_expires_idx
  ON postel_received_messages (expires_at);
