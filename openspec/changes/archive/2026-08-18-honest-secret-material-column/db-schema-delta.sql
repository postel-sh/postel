-- Postel canonical DB schema — migration 0007 (endpoint secret material column).
--
-- Dialect: Postgres >= 14. SQLite >= 3.40 variants noted inline as
-- `-- SQLite:` comments.
--
-- `endpoint_secrets.encrypted_value` is renamed to `material` — no encryption
-- is applied to it (the KMS adapter is deferred and fail-fast), and the old
-- name misled adopters into believing at-rest encryption was on. A new
-- `encryption` discriminator column records what protection (if any) was
-- applied to the row; today every row is 'plaintext', the only strategy the
-- fail-fast construction gate in outbound.ts currently allows through. A
-- future KMS adapter populates this column with 'aws-kms' | 'gcp-kms' |
-- 'vault' per row as secrets are (re-)written under envelope encryption.
-- Forward-only and idempotent.

ALTER TABLE endpoint_secrets RENAME COLUMN encrypted_value TO material;
-- SQLite: ALTER TABLE endpoint_secrets RENAME COLUMN encrypted_value TO material;

ALTER TABLE endpoint_secrets ADD COLUMN IF NOT EXISTS encryption text NOT NULL DEFAULT 'plaintext';
-- SQLite: ALTER TABLE endpoint_secrets ADD COLUMN encryption TEXT NOT NULL DEFAULT 'plaintext';

INSERT INTO _postel_meta (key, value)
VALUES ('schema_version', '7')
ON CONFLICT (key) DO UPDATE SET value = '7';
