const DIALECTS = ["postgres", "sqlite", "mysql"] as const;
type Dialect = (typeof DIALECTS)[number];

interface MigrateOptions {
  readonly dialect: Dialect;
  readonly url: string;
}

function parseArgs(argv: ReadonlyArray<string>): MigrateOptions {
  let dialect: string | undefined;
  let url: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dialect") dialect = argv[++i];
    else if (argv[i] === "--url") url = argv[++i];
  }
  if (dialect === undefined)
    throw new Error("missing required flag --dialect <postgres|sqlite|mysql>");
  if (url === undefined) throw new Error("missing required flag --url <connection-string>");
  if (!(DIALECTS as ReadonlyArray<string>).includes(dialect)) {
    throw new Error(`unsupported --dialect "${dialect}" (expected postgres, sqlite, or mysql)`);
  }
  return { dialect: dialect as Dialect, url };
}

// Runs the target dialect's canonical forward-only migrations (the same ones
// its standalone adapter runs via autoMigrate) and brings the database to the
// current schema version. Owns the connection itself (rather than handing the
// adapter a bare connectionString) so it can close it afterward instead of
// leaving the process to reap it on exit — idempotent, safe to rerun.
export async function runMigrate(argv: ReadonlyArray<string>): Promise<void> {
  const { dialect, url } = parseArgs(argv);
  switch (dialect) {
    case "postgres": {
      const { Pool } = await import("pg");
      const { PgStorage } = await import("@postel/pg");
      const pool = new Pool({ connectionString: url });
      try {
        await PgStorage({ pool }).schemaVersion();
      } finally {
        await pool.end();
      }
      return;
    }
    case "sqlite": {
      const { default: Database } = await import("better-sqlite3");
      const { SqliteStorage } = await import("@postel/sqlite");
      const db = new Database(url);
      try {
        await SqliteStorage({ db }).schemaVersion();
      } finally {
        db.close();
      }
      return;
    }
    case "mysql": {
      const { createPool } = await import("mysql2/promise");
      const { MysqlStorage } = await import("@postel/mysql");
      const pool = createPool(url);
      try {
        await MysqlStorage({ pool }).schemaVersion();
      } finally {
        await pool.end();
      }
      return;
    }
  }
}
