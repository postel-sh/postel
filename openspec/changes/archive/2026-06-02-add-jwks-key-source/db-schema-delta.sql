-- Store the published public key for asymmetric (v1a) signing secrets, so the
-- sender can serve its current public keys via JWKS (outbound.keys.publicJwks)
-- and stamp a matching webhook-key-id (the RFC 7638 thumbprint). NULL for HMAC
-- (v1) secrets, which are never published.
ALTER TABLE endpoint_secrets
  ADD COLUMN IF NOT EXISTS public_key bytea;   -- SQLite: public_key BLOB
