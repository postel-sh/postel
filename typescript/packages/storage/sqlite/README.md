# @postel/sqlite

> Standalone Postel storage adapter — Postel owns the SQLite database; zero-config drop-in.

This package is part of [Postel](https://github.com/postel-sh/postel), a polyglot library for sending and receiving webhooks reliably and securely. `@postel/sqlite` implements the full outbound `Storage` interface on top of [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) — the simplest way to get durable, single-node webhook delivery with no server to run. It also exports `SqliteDedup` for inbound idempotency-dedup.

```bash
npm install @postel/sqlite better-sqlite3
```

```ts title="lib/postel.ts"
import { Postel } from "@postel/core";
import { SqliteStorage } from "@postel/sqlite";

export const postel = Postel({
  outbound: {
    storage: SqliteStorage({ filename: "postel.db" }), // ":memory:" for tests
  },
});
```

`autoMigrate` (default `true`) brings the database up to the current schema on first use. SQLite has no `LISTEN`/`NOTIFY`, so workers poll the outbox instead of being pushed; delivery is identical, only wake-up latency differs. See [SQLite storage](https://postel.dev/docs/storage/sqlite) for options, `SqliteDedup`, and single-writer notes.

## License

MIT
