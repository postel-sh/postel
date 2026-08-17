# @postel/prisma

> Postel storage adapter — host hands Postel a PrismaClient instance (Postgres, MySQL, or SQLite).

This package is part of [Postel](https://github.com/postel-sh/postel), a polyglot library for sending and receiving webhooks reliably and securely. `@postel/prisma` runs Postel's outbound `Storage` through your `PrismaClient`'s raw query surface (`$queryRawUnsafe` / `$executeRawUnsafe` / `$transaction`), sharing your connection and transactions — no Postel models required in your `schema.prisma`.

```bash
npm install @postel/prisma
```

```ts title="lib/postel.ts"
import { PrismaClient } from "@prisma/client";
import { Postel } from "@postel/core";
import { PrismaStorage } from "@postel/prisma";

const prisma = new PrismaClient();

export const postel = Postel({
  outbound: {
    storage: PrismaStorage({ prisma, dialect: "postgres" }), // or "mysql" | "sqlite"
  },
});
```

`dialect` selects the reservation strategy, capability flags, and column codecs — wire-compatible engines (MariaDB, PlanetScale, libSQL/Turso, …) work via the matching family. `autoMigrate` (default `true`) creates Postel's tables via raw SQL on first use, independent of your Prisma schema. See [Prisma storage](https://postel.dev/docs/storage/prisma) for options and the shared-transaction recipe.

## License

MIT
