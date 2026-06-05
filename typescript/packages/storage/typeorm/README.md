# @postel/typeorm

> Postel storage adapter — host hands Postel a TypeORM `DataSource` (Postgres, MySQL, or SQLite).

Part of [Postel](https://github.com/postel-sh/postel), a polyglot library for sending and receiving webhooks reliably and securely. This adapter runs Postel's storage through the **TypeORM `DataSource` you already have**, so outbox inserts compose with your transactions and Postel opens no separate connection.

Postel talks to TypeORM purely through QueryRunners and raw SQL — **no Postel entities are required** in your schema.

## Install

```bash
npm install @postel/typeorm typeorm
# plus your driver: pg | mysql2 | better-sqlite3
```

## Usage

```ts
import { Postel } from "@postel/core";
import { TypeOrmStorage } from "@postel/typeorm";
import { dataSource } from "./data-source"; // your initialized TypeORM DataSource

export const postel = Postel({
  outbound: { storage: TypeOrmStorage({ dataSource, dialect: "postgres" }) },
});
```

`dialect` is one of `"postgres" | "mysql" | "sqlite"` — it selects the canonical
schema dialect and the worker-reservation strategy. On Postgres and MySQL workers
reserve rows under `FOR UPDATE SKIP LOCKED`; on SQLite they reserve in a single
statement. MySQL and SQLite have no `LISTEN`/`NOTIFY`, so the scheduler polls;
Postgres pushes.

### Composing with your transaction

`Postel({...}).transaction(cb)` hands your callback a connection-bound executor you
thread into `send()`:

```ts
await postel.outbound.transaction(async (tx) => {
  await postel.send({ type: "order.created", data: { /* ... */ } }, { tx });
});
```

## Notes

- Timestamps are stored as `BIGINT` epoch-milliseconds on MySQL (timezone-independent), `timestamptz` on Postgres, ISO-8601 `TEXT` on SQLite — one canonical schema per dialect, shared with the other Postel adapters.
- Migrations run on first boot (`autoMigrate` defaults to on); pass `autoMigrate: false` if you run them yourself.

## License

MIT
