# @postel/drizzle

> Postel storage adapter — host hands Postel a Drizzle instance (Postgres, MySQL, or SQLite).

This package is part of [Postel](https://github.com/postel-sh/postel), a polyglot library for sending and receiving webhooks reliably and securely. `@postel/drizzle` runs Postel's outbound `Storage` through the [Drizzle](https://orm.drizzle.team/) `db` you already use, so outbox writes share your connection and transactions — no Postel-specific table definitions required in your schema.

```bash
npm install @postel/drizzle drizzle-orm
# plus your driver: pg | mysql2 | better-sqlite3
```

```ts title="lib/postel.ts"
import { drizzle } from "drizzle-orm/node-postgres";
import { Postel } from "@postel/core";
import { DrizzleStorage } from "@postel/drizzle";

const db = drizzle(process.env.DATABASE_URL);

export const postel = Postel({
  outbound: {
    storage: DrizzleStorage({ db, dialect: "postgres" }), // or "mysql" | "sqlite"
  },
});
```

`dialect` selects the reservation strategy, capability flags, and column codecs — wire-compatible engines (MariaDB, PlanetScale, libSQL/Turso, …) work via the matching family. `autoMigrate` (default `true`) runs the canonical migrations on first use. See [Drizzle storage](https://postel.dev/docs/storage/drizzle) for options and the shared-transaction recipe.

## License

MIT
