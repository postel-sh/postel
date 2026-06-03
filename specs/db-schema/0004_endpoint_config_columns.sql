-- Postel canonical DB schema — migration 0004 (endpoints delivery-config columns).
--
-- Dialect: Postgres >= 14. SQLite >= 3.40 variants noted inline as
-- `-- SQLite:` comments.
--
-- Adds the per-endpoint delivery-config columns the Storage contract
-- (EndpointRecord) persists through endpoints.create / endpoints.update but
-- that 0001 omitted:
--   - allow_http      : opt-in to plaintext-HTTP delivery (default off).
--   - max_inflight    : per-endpoint in-flight dispatch cap (NULL = unbounded).
--   - http            : per-endpoint HTTP defaults (timeouts, TLS, SSRF, …).
--   - circuit_breaker : per-endpoint circuit-breaker config.
--   - auto_disable    : per-endpoint auto-disable config.
-- Forward-only and idempotent.

ALTER TABLE endpoints
  ADD COLUMN IF NOT EXISTS allow_http boolean NOT NULL DEFAULT false;  -- SQLite: allow_http INTEGER NOT NULL DEFAULT 0

ALTER TABLE endpoints
  ADD COLUMN IF NOT EXISTS max_inflight integer;

ALTER TABLE endpoints
  ADD COLUMN IF NOT EXISTS http jsonb;             -- SQLite: http TEXT (JSON)

ALTER TABLE endpoints
  ADD COLUMN IF NOT EXISTS circuit_breaker jsonb;  -- SQLite: circuit_breaker TEXT (JSON)

ALTER TABLE endpoints
  ADD COLUMN IF NOT EXISTS auto_disable jsonb;     -- SQLite: auto_disable TEXT (JSON)

INSERT INTO _postel_meta (key, value)
VALUES ('schema_version', '4')
ON CONFLICT (key) DO UPDATE SET value = '4';
