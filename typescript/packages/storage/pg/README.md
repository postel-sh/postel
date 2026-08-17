# @postel/pg

> Standalone Postel storage adapter — Postel owns the Postgres pool; zero-config drop-in.

This package is part of [Postel](https://github.com/postel-sh/postel), a polyglot library for sending and receiving webhooks reliably and securely. `@postel/pg` implements the full outbound `Storage` interface on top of [`node-postgres`](https://node-postgres.com/), with `FOR UPDATE SKIP LOCKED` reservation and `LISTEN`/`NOTIFY` wakeups — the adapter for multi-node, high-throughput delivery. It also exports `PgDedup` for inbound idempotency-dedup.

```bash
npm install @postel/pg pg
```

```ts title="lib/postel.ts"
import { Pool } from "pg";
import { Postel } from "@postel/core";
import { PgStorage } from "@postel/pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const postel = Postel({
  outbound: {
    storage: PgStorage({ pool }), // or PgStorage({ connectionString }) to let Postel own the pool
  },
});
```

`autoMigrate` (default `true`) brings the database up to the current schema on first use. See [Postgres storage](https://postel.dev/docs/storage/pg) for options, `PgDedup`, and the transaction-sharing recipe.

## License

MIT
