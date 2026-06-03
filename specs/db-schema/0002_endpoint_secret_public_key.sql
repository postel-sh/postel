-- Postel canonical DB schema — migration 0002 (endpoint_secrets.public_key).
--
-- Dialect: Postgres ≥ 14. SQLite ≥ 3.40 variants noted inline as
-- `-- SQLite:` comments.
--
-- Stores the published public key for asymmetric (v1a) signing secrets, so the
-- sender can serve its current public keys via JWKS (outbound.keys.publicJwks)
-- and stamp a matching webhook-key-id (the RFC 7638 JWK thumbprint). NULL for
-- HMAC (v1) secrets, which are never published. Forward-only and idempotent.

ALTER TABLE endpoint_secrets
  ADD COLUMN IF NOT EXISTS public_key bytea;   -- SQLite: public_key BLOB

INSERT INTO _postel_meta (key, value)
VALUES ('schema_version', '2')
ON CONFLICT (key) DO UPDATE SET value = '2';
