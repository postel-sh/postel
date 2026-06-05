# @postel/mysql

> Standalone Postel storage adapter — Postel owns the MySQL pool; zero-config drop-in.

Part of [Postel](https://github.com/postel-sh/postel), a polyglot library for sending and receiving webhooks reliably and securely. This package is the **standalone MySQL adapter**: Postel opens and owns a [`mysql2`](https://github.com/sidorares/node-mysql2) pool and runs migrations on first boot. If you already run MySQL through Drizzle, Kysely, Prisma, TypeORM, or MikroORM, use that ORM's adapter instead so outbox writes join your transactions.

Requires **MySQL ≥ 8.0.1** (for `FOR UPDATE SKIP LOCKED`). MariaDB ≥ 10.6 also works via `mysql2`.

## Install

```bash
npm install @postel/mysql mysql2
```

## Outbound storage

```ts
import { Postel } from "@postel/core";
import { MysqlStorage } from "@postel/mysql";

export const postel = Postel({
  outbound: { storage: MysqlStorage({ connectionString: process.env.DATABASE_URL }) },
});
```

Pass `connectionString` and Postel owns the pool, or hand it an existing `mysql2` pool:

```ts
import { createPool } from "mysql2/promise";
const pool = createPool(process.env.DATABASE_URL);
const storage = MysqlStorage({ pool });
```

Outbox inserts join your transaction when you thread one through:

```ts
const conn = await pool.getConnection();
await conn.beginTransaction();
await postel.send({ type: "order.created", data: { /* ... */ } }, { tx: conn });
await conn.commit();
conn.release();
```

## Inbound dedup

`MysqlDedup` backs receiver-side idempotency with the same `mysql2` client:

```ts
import { MysqlDedup } from "@postel/mysql";
const dedup = MysqlDedup({ client: pool });
```

## Behavior notes

- **No `LISTEN`/`NOTIFY`.** MySQL has no push channel, so the adapter advertises `capabilities.notify = false` and the worker scheduler polls the outbox. Delivery is identical to Postgres — only dispatch latency differs.
- **Reservation.** Workers reserve rows under `FOR UPDATE SKIP LOCKED`; because MySQL has no `RETURNING`, reservation is a select-then-update inside one transaction.
- **Schema.** Timestamps are stored as `BIGINT` epoch-milliseconds (timezone-independent), JSON as `JSON` columns, ids/keys as `VARCHAR(191)`. This is one canonical MySQL schema shared with the ORM adapters' MySQL dialect, so you can switch adapters on the same database. Migrations are idempotent (`autoMigrate` defaults to on).

## License

MIT
