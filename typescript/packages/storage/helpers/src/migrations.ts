// Forward-only migration SQL, transcribed from the canonical specs/db-schema/
// (Postgres dialect) into each adapter dialect. Standalone / client / query-
// builder adapters run these through the host connection; a migration test in
// each adapter asserts the post-migrate schema matches the canonical tables and
// columns (drift guard). ORM adapters ship DSL fragments instead.

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

// SQLite dialect (>= 3.40). timestamptz -> TEXT (ISO-8601), jsonb -> TEXT,
// bytea -> BLOB, boolean -> INTEGER 0/1. Idempotency is provided by the
// version gate in each adapter's migrate(), so column ALTERs need no
// IF NOT EXISTS (they run exactly once, when crossing their version). Like the
// Postgres set, the canonical FOREIGN KEY constraints are not declared —
// referential integrity is maintained application-side, so the relationship
// columns are plain TEXT (and an adapter need not toggle the host's
// foreign_keys pragma).
export const SQLITE_MIGRATIONS: ReadonlyArray<Migration> = [
  {
    version: 1,
    name: "init",
    sql: `
CREATE TABLE IF NOT EXISTS _postel_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id         TEXT PRIMARY KEY,
  metadata   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS endpoints (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT,
  url          TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'active',
  types        TEXT,
  channels     TEXT,
  retry_policy TEXT,
  headers      TEXT,
  signing      TEXT,
  metadata     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS endpoints_tenant_idx ON endpoints (tenant_id);
CREATE INDEX IF NOT EXISTS endpoints_state_idx ON endpoints (state);

CREATE TABLE IF NOT EXISTS endpoint_secrets (
  id              TEXT PRIMARY KEY,
  endpoint_id     TEXT NOT NULL,
  algorithm       TEXT NOT NULL,
  status          TEXT NOT NULL,
  priority        INTEGER NOT NULL,
  encrypted_value BLOB NOT NULL,
  not_after       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS endpoint_secrets_endpoint_idx ON endpoint_secrets (endpoint_id, priority);

CREATE TABLE IF NOT EXISTS messages (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT,
  type             TEXT NOT NULL,
  data             TEXT NOT NULL,
  channels         TEXT,
  idempotency_key  TEXT,
  version          TEXT,
  ttl_seconds      INTEGER,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at       TEXT,
  reserved_by      TEXT,
  reserved_at      TEXT,
  lease_expires_at TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_tenant_idem_idx
  ON messages (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_pending_idx
  ON messages (status, created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS attempts (
  id               TEXT PRIMARY KEY,
  message_id       TEXT NOT NULL,
  endpoint_id      TEXT NOT NULL,
  tenant_id        TEXT,
  attempt_number   INTEGER NOT NULL,
  status           TEXT NOT NULL,
  scheduled_for    TEXT,
  started_at       TEXT,
  completed_at     TEXT,
  response_code    INTEGER,
  response_headers TEXT,
  response_body    TEXT,
  latency_ms       INTEGER,
  error            TEXT,
  replay_of        TEXT
);
CREATE INDEX IF NOT EXISTS attempts_message_idx ON attempts (message_id);
CREATE INDEX IF NOT EXISTS attempts_endpoint_idx ON attempts (endpoint_id, scheduled_for);
CREATE INDEX IF NOT EXISTS attempts_tenant_idx ON attempts (tenant_id);
CREATE INDEX IF NOT EXISTS attempts_status_idx ON attempts (status);

CREATE TABLE IF NOT EXISTS endpoint_state_transitions (
  id          TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  from_state  TEXT,
  to_state    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  actor       TEXT,
  metadata    TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS endpoint_state_transitions_endpoint_idx
  ON endpoint_state_transitions (endpoint_id, occurred_at DESC);

CREATE VIEW IF NOT EXISTS dead_letter AS SELECT a.* FROM attempts a WHERE a.status = 'dead-letter';

INSERT INTO _postel_meta (key, value) VALUES ('schema_version', '1')
  ON CONFLICT (key) DO UPDATE SET value = '1';
`,
  },
  {
    version: 2,
    name: "endpoint_secret_public_key",
    sql: `
ALTER TABLE endpoint_secrets ADD COLUMN public_key BLOB;
INSERT INTO _postel_meta (key, value) VALUES ('schema_version', '2')
  ON CONFLICT (key) DO UPDATE SET value = '2';
`,
  },
  {
    version: 3,
    name: "message_dispatch_columns",
    sql: `
ALTER TABLE messages ADD COLUMN attempt_number INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN scheduled_for TEXT;
ALTER TABLE messages ADD COLUMN replay_of TEXT;
CREATE INDEX IF NOT EXISTS messages_scheduled_idx ON messages (scheduled_for) WHERE status = 'pending';
INSERT INTO _postel_meta (key, value) VALUES ('schema_version', '3')
  ON CONFLICT (key) DO UPDATE SET value = '3';
`,
  },
  {
    version: 4,
    name: "endpoint_config_columns",
    sql: `
ALTER TABLE endpoints ADD COLUMN allow_http INTEGER NOT NULL DEFAULT 0;
ALTER TABLE endpoints ADD COLUMN max_inflight INTEGER;
ALTER TABLE endpoints ADD COLUMN http TEXT;
ALTER TABLE endpoints ADD COLUMN circuit_breaker TEXT;
ALTER TABLE endpoints ADD COLUMN auto_disable TEXT;
INSERT INTO _postel_meta (key, value) VALUES ('schema_version', '4')
  ON CONFLICT (key) DO UPDATE SET value = '4';
`,
  },
];

// Postgres dialect (>= 14). jsonb / timestamptz / bytea native. The
// keyset-ordered created_at columns (tenants / endpoints / messages) are
// timestamptz(3): the opaque pagination cursors encode millisecond ISO-8601,
// so sub-ms stored values would silently drop rows from paginated walks
// (ADR 0015). Column ALTERs
// use IF NOT EXISTS so the migration set is idempotent even without the version
// gate. Mirrors specs/db-schema/ — except the canonical FOREIGN KEY constraints
// are intentionally not declared: the library maintains referential integrity
// application-side (matching the in-memory reference and SQLite, which runs with
// foreign_keys off), so the relationship columns are plain `text`.
export const PG_MIGRATIONS: ReadonlyArray<Migration> = [
  {
    version: 1,
    name: "init",
    sql: `
CREATE TABLE IF NOT EXISTS _postel_meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id         text PRIMARY KEY,
  metadata   jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS endpoints (
  id           text PRIMARY KEY,
  tenant_id    text,
  url          text NOT NULL,
  state        text NOT NULL DEFAULT 'active',
  types        jsonb,
  channels     jsonb,
  retry_policy jsonb,
  headers      jsonb,
  signing      jsonb,
  metadata     jsonb,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS endpoints_tenant_idx ON endpoints (tenant_id);
CREATE INDEX IF NOT EXISTS endpoints_state_idx ON endpoints (state);

CREATE TABLE IF NOT EXISTS endpoint_secrets (
  id              text PRIMARY KEY,
  endpoint_id     text NOT NULL,
  algorithm       text NOT NULL,
  status          text NOT NULL,
  priority        integer NOT NULL,
  encrypted_value bytea NOT NULL,
  not_after       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS endpoint_secrets_endpoint_idx ON endpoint_secrets (endpoint_id, priority);

CREATE TABLE IF NOT EXISTS messages (
  id               text PRIMARY KEY,
  tenant_id        text,
  type             text NOT NULL,
  data             jsonb NOT NULL,
  channels         jsonb,
  idempotency_key  text,
  version          text,
  ttl_seconds      integer,
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  reserved_by      text,
  reserved_at      timestamptz,
  lease_expires_at timestamptz,
  status           text NOT NULL DEFAULT 'pending'
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_tenant_idem_idx
  ON messages (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_pending_idx
  ON messages (status, created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS attempts (
  id               text PRIMARY KEY,
  message_id       text NOT NULL,
  endpoint_id      text NOT NULL,
  tenant_id        text,
  attempt_number   integer NOT NULL,
  status           text NOT NULL,
  scheduled_for    timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  response_code    integer,
  response_headers jsonb,
  response_body    text,
  latency_ms       integer,
  error            text,
  replay_of        text
);
CREATE INDEX IF NOT EXISTS attempts_message_idx ON attempts (message_id);
CREATE INDEX IF NOT EXISTS attempts_endpoint_idx ON attempts (endpoint_id, scheduled_for);
CREATE INDEX IF NOT EXISTS attempts_tenant_idx ON attempts (tenant_id);
CREATE INDEX IF NOT EXISTS attempts_status_idx ON attempts (status);

CREATE TABLE IF NOT EXISTS endpoint_state_transitions (
  id          text PRIMARY KEY,
  endpoint_id text NOT NULL,
  from_state  text,
  to_state    text NOT NULL,
  reason      text NOT NULL,
  actor       text,
  metadata    jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS endpoint_state_transitions_endpoint_idx
  ON endpoint_state_transitions (endpoint_id, occurred_at DESC);

CREATE OR REPLACE VIEW dead_letter AS SELECT a.* FROM attempts a WHERE a.status = 'dead-letter';

INSERT INTO _postel_meta (key, value) VALUES ('schema_version', '1')
  ON CONFLICT (key) DO NOTHING;
`,
  },
  {
    version: 2,
    name: "endpoint_secret_public_key",
    sql: `
ALTER TABLE endpoint_secrets ADD COLUMN IF NOT EXISTS public_key bytea;
INSERT INTO _postel_meta (key, value) VALUES ('schema_version', '2')
  ON CONFLICT (key) DO UPDATE SET value = '2';
`,
  },
  {
    version: 3,
    name: "message_dispatch_columns",
    sql: `
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attempt_number integer NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS replay_of text;
CREATE INDEX IF NOT EXISTS messages_scheduled_idx ON messages (scheduled_for) WHERE status = 'pending';
INSERT INTO _postel_meta (key, value) VALUES ('schema_version', '3')
  ON CONFLICT (key) DO UPDATE SET value = '3';
`,
  },
  {
    version: 4,
    name: "endpoint_config_columns",
    sql: `
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS allow_http boolean NOT NULL DEFAULT false;
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS max_inflight integer;
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS http jsonb;
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS circuit_breaker jsonb;
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS auto_disable jsonb;
INSERT INTO _postel_meta (key, value) VALUES ('schema_version', '4')
  ON CONFLICT (key) DO UPDATE SET value = '4';
`,
  },
];

// MySQL dialect (>= 8.0.1, for FOR UPDATE SKIP LOCKED). timestamptz -> BIGINT
// epoch-milliseconds (timezone-independent — see MYSQL_CODEC), jsonb -> JSON,
// bytea -> BLOB, boolean -> TINYINT(1), text PK / indexed key -> VARCHAR(191)
// (MySQL can't index TEXT without a prefix length; 191 is utf8mb4-index-safe).
// MySQL has neither partial indexes (the canonical `WHERE`-filtered indexes
// become plain indexes — the app-level select-then-insert preserves the
// null-tenant idempotency the partial unique would otherwise back) nor
// `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, so column/index
// migrations carry no IF NOT EXISTS and rely on the version gate in each
// adapter's migrate() to run exactly once. Indexes are declared inline in
// CREATE TABLE for the init migration. The reserved word `key` is backtick-
// quoted; adapters split this SQL on `;` and run each statement (mysql2 does
// not allow multiple statements per query by default). Like the other dialects
// the canonical FOREIGN KEY constraints are intentionally not declared.
// Every table pins DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin: ids are
// mixed-case opaque tokens compared and keyset-ordered byte-wise (ADR 0015);
// the utf8mb4_0900_ai_ci server default is case-insensitive, which makes
// distinct ids compare equal and breaks the pagination id tie-break. One
// collation across all tables also keeps id joins/subqueries mix-free.
// Timestamps are BIGINT epoch-milliseconds, which is already exactly the
// millisecond precision the keyset cursors require.
export const MYSQL_MIGRATIONS: ReadonlyArray<Migration> = [
  {
    version: 1,
    name: "init",
    sql: `
CREATE TABLE IF NOT EXISTS _postel_meta (
  \`key\` VARCHAR(191) PRIMARY KEY,
  value  TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS tenants (
  id         VARCHAR(191) PRIMARY KEY,
  metadata   JSON,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS endpoints (
  id           VARCHAR(191) PRIMARY KEY,
  tenant_id    VARCHAR(191),
  url          TEXT NOT NULL,
  state        VARCHAR(191) NOT NULL DEFAULT 'active',
  types        JSON,
  channels     JSON,
  retry_policy JSON,
  headers      JSON,
  signing      JSON,
  metadata     JSON,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  INDEX endpoints_tenant_idx (tenant_id),
  INDEX endpoints_state_idx (state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS endpoint_secrets (
  id              VARCHAR(191) PRIMARY KEY,
  endpoint_id     VARCHAR(191) NOT NULL,
  algorithm       VARCHAR(191) NOT NULL,
  status          VARCHAR(191) NOT NULL,
  priority        INT NOT NULL,
  encrypted_value BLOB NOT NULL,
  not_after       BIGINT,
  created_at      BIGINT NOT NULL,
  INDEX endpoint_secrets_endpoint_idx (endpoint_id, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS messages (
  id               VARCHAR(191) PRIMARY KEY,
  tenant_id        VARCHAR(191),
  type             VARCHAR(191) NOT NULL,
  data             JSON NOT NULL,
  channels         JSON,
  idempotency_key  VARCHAR(191),
  version          VARCHAR(191),
  ttl_seconds      INT,
  created_at       BIGINT NOT NULL,
  expires_at       BIGINT,
  reserved_by      VARCHAR(191),
  reserved_at      BIGINT,
  lease_expires_at BIGINT,
  status           VARCHAR(191) NOT NULL DEFAULT 'pending',
  UNIQUE KEY messages_tenant_idem_idx (tenant_id, idempotency_key),
  INDEX messages_pending_idx (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS attempts (
  id               VARCHAR(191) PRIMARY KEY,
  message_id       VARCHAR(191) NOT NULL,
  endpoint_id      VARCHAR(191) NOT NULL,
  tenant_id        VARCHAR(191),
  attempt_number   INT NOT NULL,
  status           VARCHAR(191) NOT NULL,
  scheduled_for    BIGINT,
  started_at       BIGINT,
  completed_at     BIGINT,
  response_code    INT,
  response_headers JSON,
  response_body    LONGTEXT,
  latency_ms       INT,
  error            TEXT,
  replay_of        VARCHAR(191),
  INDEX attempts_message_idx (message_id),
  INDEX attempts_endpoint_idx (endpoint_id, scheduled_for),
  INDEX attempts_tenant_idx (tenant_id),
  INDEX attempts_status_idx (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS endpoint_state_transitions (
  id          VARCHAR(191) PRIMARY KEY,
  endpoint_id VARCHAR(191) NOT NULL,
  from_state  VARCHAR(191),
  to_state    VARCHAR(191) NOT NULL,
  reason      TEXT NOT NULL,
  actor       VARCHAR(191),
  metadata    JSON,
  occurred_at BIGINT NOT NULL,
  INDEX endpoint_state_transitions_endpoint_idx (endpoint_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE OR REPLACE VIEW dead_letter AS SELECT a.* FROM attempts a WHERE a.status = 'dead-letter';

INSERT INTO _postel_meta (\`key\`, value) VALUES ('schema_version', '1')
  ON DUPLICATE KEY UPDATE value = '1';
`,
  },
  {
    version: 2,
    name: "endpoint_secret_public_key",
    sql: `
ALTER TABLE endpoint_secrets ADD COLUMN public_key BLOB;
INSERT INTO _postel_meta (\`key\`, value) VALUES ('schema_version', '2')
  ON DUPLICATE KEY UPDATE value = '2';
`,
  },
  {
    version: 3,
    name: "message_dispatch_columns",
    sql: `
ALTER TABLE messages ADD COLUMN attempt_number INT NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN scheduled_for BIGINT;
ALTER TABLE messages ADD COLUMN replay_of VARCHAR(191);
CREATE INDEX messages_scheduled_idx ON messages (scheduled_for);
INSERT INTO _postel_meta (\`key\`, value) VALUES ('schema_version', '3')
  ON DUPLICATE KEY UPDATE value = '3';
`,
  },
  {
    version: 4,
    name: "endpoint_config_columns",
    sql: `
ALTER TABLE endpoints ADD COLUMN allow_http TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE endpoints ADD COLUMN max_inflight INT;
ALTER TABLE endpoints ADD COLUMN http JSON;
ALTER TABLE endpoints ADD COLUMN circuit_breaker JSON;
ALTER TABLE endpoints ADD COLUMN auto_disable JSON;
INSERT INTO _postel_meta (\`key\`, value) VALUES ('schema_version', '4')
  ON DUPLICATE KEY UPDATE value = '4';
`,
  },
];
