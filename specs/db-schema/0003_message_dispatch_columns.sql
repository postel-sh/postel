-- Postel canonical DB schema — migration 0003 (messages dispatch-state columns).
--
-- Dialect: Postgres >= 14. SQLite >= 3.40 variants noted inline as
-- `-- SQLite:` comments.
--
-- Adds the per-message dispatch-state columns the outbox worker path requires
-- but that 0001 omitted:
--   - attempt_number : incremented on each reserveBatch reservation.
--   - scheduled_for  : retry-backoff time; workers skip rows scheduled in the
--                      future and reserve due rows first.
--   - replay_of      : set on a replay so the row's subsequent attempts are
--                      tagged as replay traffic (references the original
--                      message id; enforced application-side, see below).
-- These are exactly the fields reserveBatch reads back into a ReservedMessage.
-- Forward-only and idempotent.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attempt_number integer NOT NULL DEFAULT 0;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;   -- SQLite: scheduled_for TEXT (ISO-8601)

-- replay_of points back to messages(id). Postgres could enforce this with a
-- FK, but SQLite's ALTER TABLE ADD COLUMN cannot add a foreign key, so to keep
-- one statement across both dialects the column is plain text and the
-- reference is enforced application-side (matching how attempts.replay_of
-- degrades to ON DELETE SET NULL).
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS replay_of text;              -- SQLite: replay_of TEXT

-- Lets the worker cheaply find rows that are due now, mirroring
-- messages_pending_idx. NULL scheduled_for (never-deferred) rows are due.
CREATE INDEX IF NOT EXISTS messages_scheduled_idx
  ON messages (scheduled_for)
  WHERE status = 'pending';

INSERT INTO _postel_meta (key, value)
VALUES ('schema_version', '3')
ON CONFLICT (key) DO UPDATE SET value = '3';
