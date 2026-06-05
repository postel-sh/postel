# @postel/mikro-orm

> Postel storage adapter — host hands Postel a MikroORM `EntityManager` (Postgres, MySQL, or SQLite).

Part of [Postel](https://github.com/postel-sh/postel), a polyglot library for sending and receiving webhooks reliably and securely. This adapter runs Postel's storage through the **MikroORM instance you already have**, via the connection's raw `execute` — so outbox inserts compose with your transactions and Postel opens no separate connection. **No Postel entities are required** in your schema.

## Install

```bash
npm install @postel/mikro-orm @mikro-orm/core
# plus your driver: @mikro-orm/postgresql | @mikro-orm/mysql | @mikro-orm/better-sqlite
```

## Usage

```ts
import { Postel } from "@postel/core";
import { MikroOrmStorage } from "@postel/mikro-orm";
import { orm } from "./mikro-orm"; // your initialized MikroORM

export const postel = Postel({
  outbound: { storage: MikroOrmStorage({ orm, dialect: "postgres" }) },
});
```

Pass `orm` (a `MikroORM`) or `em` (an `EntityManager`), plus `dialect`
(`"postgres" | "mysql" | "sqlite"`). On Postgres and MySQL workers reserve rows
under `FOR UPDATE SKIP LOCKED`; on SQLite in a single statement. MySQL and SQLite
have no `LISTEN`/`NOTIFY`, so the scheduler polls; Postgres pushes.

### Composing with your transaction

`Postel({...}).outbound.transaction(cb)` hands your callback a transaction context
you thread into `send()`:

```ts
await postel.outbound.transaction(async (tx) => {
  await postel.send({ type: "order.created", data: { /* ... */ } }, { tx });
});
```

## Notes

- Built on MikroORM's `connection.execute(sql, params, 'all' | 'run')` — `'all'` returns rows, `'run'` returns the affected-row count, uniformly across drivers.
- Timestamps are stored as `BIGINT` epoch-milliseconds on MySQL (timezone-independent), `timestamptz` on Postgres, ISO-8601 `TEXT` on SQLite — one canonical schema per dialect, shared with the other Postel adapters.
- Migrations run on first boot (`autoMigrate` defaults to on); pass `autoMigrate: false` if you run them yourself.

## License

MIT
