# @postel/kysely

> Postel storage adapter — host hands Postel a Kysely query-builder instance (Postgres, MySQL, or SQLite).

This package is part of [Postel](https://github.com/postel-sh/postel), a polyglot library for sending and receiving webhooks reliably and securely. `@postel/kysely` runs Postel's outbound `Storage` through the [Kysely](https://kysely.dev/) instance you already use, so the outbox insert shares your connection and composes with your own transactions — no second pool, no Postel-specific table typing.

```bash
npm install @postel/kysely kysely
# plus your driver: pg | mysql2 | better-sqlite3
```

```ts title="lib/postel.ts"
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { Postel } from "@postel/core";
import { KyselyStorage } from "@postel/kysely";

const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }),
});

export const postel = Postel({
  outbound: {
    storage: KyselyStorage({ db, dialect: "postgres" }), // or "mysql" | "sqlite"
  },
});
```

`dialect` selects the reservation strategy, capability flags, and column codecs — wire-compatible engines (MariaDB, PlanetScale, libSQL/Turso, …) work via the matching family. `autoMigrate` (default `true`) runs the canonical migrations on first use. See [Kysely storage](https://postel.dev/docs/storage/kysely) for options and the shared-transaction recipe.

## License

MIT
