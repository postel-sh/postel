-- Postel canonical DB schema — migration 0001 (init).
--
-- Dialect: Postgres ≥ 14. SQLite ≥ 3.40 variants noted inline as
-- `-- SQLite:` comments.
--
-- Conventions:
--   - Forward-only. Future migrations are 0002_*.sql, 0003_*.sql, ...
--   - All persistent rows are tenant-scoped via tenant_id (NULL for
--     single-tenant deployments).
--   - Idempotent: safe to run on every boot.
--   - Keyset pagination invariants (ADR 0015): the cursor-ordered
--     `created_at` columns (tenants, endpoints, messages) are pinned to
--     millisecond precision — `timestamptz(3)` — so stored values round-trip
--     the opaque `(createdAt, id)` cursors exactly. Sub-ms precision would
--     silently drop rows from paginated walks. The `id` tie-break assumes a
--     deterministic total order; byte order (binary collation) is the
--     canonical cross-port ordering. Postgres locale collations are
--     deterministic and therefore safe (ordering may differ cosmetically);
--     MySQL MUST pin a binary collation (see the MySQL dialect in
--     @postel/storage-helpers), because its case-insensitive server default
--     makes distinct ids compare equal and breaks the tie-break.

CREATE TABLE IF NOT EXISTS _postel_meta (
  key         text PRIMARY KEY,
  value       text NOT NULL
);

INSERT INTO _postel_meta (key, value)
VALUES ('schema_version', '1')
ON CONFLICT (key) DO NOTHING;

-- Tenants (optional table; rows are NULL-tenant in single-tenant mode).
CREATE TABLE IF NOT EXISTS tenants (
  id           text PRIMARY KEY,
  metadata     jsonb,                     -- SQLite: TEXT (JSON)
  created_at   timestamptz(3) NOT NULL DEFAULT now()  -- SQLite: TEXT (ISO-8601), DEFAULT (datetime('now'))
);

-- Endpoints: one row per receiver URL the host has registered.
CREATE TABLE IF NOT EXISTS endpoints (
  id              text PRIMARY KEY,
  tenant_id       text REFERENCES tenants(id) ON DELETE CASCADE,
  url             text NOT NULL,
  state           text NOT NULL DEFAULT 'active',  -- active | disabled | circuit-open
  types           jsonb,                           -- string[] of event-type globs
  channels        jsonb,                           -- string[] of channel filters
  retry_policy    jsonb,                           -- { schedule, jitter, maxAttempts }
  headers         jsonb,                           -- static custom headers (functions are code-side)
  signing         jsonb,                           -- { algorithm: 'v1' | 'v1a', ... }
  metadata        jsonb,                           -- host-defined opaque blob
  created_at      timestamptz(3) NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS endpoints_tenant_idx ON endpoints (tenant_id);
CREATE INDEX IF NOT EXISTS endpoints_state_idx  ON endpoints (state);

-- Endpoint secrets: priority-ordered array per endpoint.
-- 'primary' is used for signing; 'verifying' and 'expiring' remain accepted
-- by receivers during rotation overlap windows.
CREATE TABLE IF NOT EXISTS endpoint_secrets (
  id              text PRIMARY KEY,
  endpoint_id     text NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  algorithm       text NOT NULL,            -- 'v1' (HMAC) | 'v1a' (Ed25519)
  status          text NOT NULL,            -- 'primary' | 'verifying' | 'expiring'
  priority        integer NOT NULL,         -- lower = higher priority
  encrypted_value bytea NOT NULL,           -- envelope-encrypted; KMS adapter unwraps
  -- SQLite: encrypted_value BLOB
  not_after       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS endpoint_secrets_endpoint_idx
  ON endpoint_secrets (endpoint_id, priority);

-- Outbox: one row per send() call.
-- Workers reserve rows via FOR UPDATE SKIP LOCKED (Postgres) or
-- BEGIN IMMEDIATE row locking (SQLite).
CREATE TABLE IF NOT EXISTS messages (
  id                 text PRIMARY KEY,
  tenant_id          text REFERENCES tenants(id) ON DELETE CASCADE,
  type               text NOT NULL,
  data               jsonb NOT NULL,        -- SQLite: TEXT (JSON)
  channels           jsonb,
  idempotency_key    text,
  version            text,
  ttl_seconds        integer,
  created_at         timestamptz(3) NOT NULL DEFAULT now(),
  expires_at         timestamptz,
  -- For SKIP LOCKED-style worker reservation:
  reserved_by        text,                  -- worker id (NULL = unreserved)
  reserved_at        timestamptz,
  lease_expires_at   timestamptz,
  -- Final disposition (for completed/expired messages):
  status             text NOT NULL DEFAULT 'pending'  -- pending | dispatched | expired
);

CREATE UNIQUE INDEX IF NOT EXISTS messages_tenant_idem_idx
  ON messages (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_pending_idx
  ON messages (status, created_at)
  WHERE status = 'pending';

-- Attempts: per-endpoint, per-message delivery attempts.
CREATE TABLE IF NOT EXISTS attempts (
  id                 text PRIMARY KEY,
  message_id         text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  endpoint_id        text NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  tenant_id          text REFERENCES tenants(id) ON DELETE CASCADE,
  attempt_number     integer NOT NULL,
  status             text NOT NULL,        -- pending | success | failed | failed-permanent | dead-letter | expired | filtered | skipped | ssrf-blocked
  scheduled_for      timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  response_code      integer,
  response_headers   jsonb,                -- truncated at storage time
  response_body      text,                 -- truncated at storage time; optional
  latency_ms         integer,
  error              text,
  replay_of          text REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS attempts_message_idx     ON attempts (message_id);
CREATE INDEX IF NOT EXISTS attempts_endpoint_idx    ON attempts (endpoint_id, scheduled_for);
CREATE INDEX IF NOT EXISTS attempts_tenant_idx      ON attempts (tenant_id);
CREATE INDEX IF NOT EXISTS attempts_status_idx      ON attempts (status);

-- Endpoint state transitions: audit trail for state changes.
CREATE TABLE IF NOT EXISTS endpoint_state_transitions (
  id            text PRIMARY KEY,
  endpoint_id   text NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  from_state    text,
  to_state      text NOT NULL,
  reason        text NOT NULL,            -- e.g., 'manual', 'auto-disable', 'circuit-open', 'circuit-close'
  actor         text,                     -- 'system' | host-supplied user id
  metadata      jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS endpoint_state_transitions_endpoint_idx
  ON endpoint_state_transitions (endpoint_id, occurred_at DESC);

-- Dead-letter view: convenience read over attempts where the final
-- disposition is exhausted. Implementations MAY materialize this view if
-- query volume warrants.
CREATE OR REPLACE VIEW dead_letter AS
SELECT
  a.*
FROM attempts a
WHERE a.status = 'dead-letter';
-- SQLite: views are read-only; same DDL works without OR REPLACE — drop and recreate
-- the view in migrations if it changes.
