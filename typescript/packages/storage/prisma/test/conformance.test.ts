import { makeFakeClock, runStorageTests } from "@postel/storage-testkit";
import Database from "better-sqlite3";

import { type PrismaLike, PrismaStorage } from "../src/index.js";

// A PrismaClient only exposes its raw surface ($queryRawUnsafe /
// $executeRawUnsafe / $transaction) to this adapter, and those are thin
// pass-throughs to the database. So we exercise the adapter against a faithful
// better-sqlite3-backed shim of that surface — proving the SQL and control flow
// without a `prisma generate` pipeline. A real-PrismaClient integration test is
// a follow-up, like @postel/pg's testcontainers tier.
function prismaShim(db: Database.Database): PrismaLike {
  const shim: PrismaLike = {
    async $queryRawUnsafe<R>(query: string, ...values: unknown[]): Promise<R[]> {
      return db.prepare(query).all(...(values as never[])) as R[];
    },
    async $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> {
      if (values.length === 0) {
        db.exec(query);
        return 0;
      }
      return db.prepare(query).run(...(values as never[])).changes;
    },
    async $transaction<R>(fn: (tx: PrismaLike) => Promise<R>): Promise<R> {
      db.exec("begin");
      try {
        const result = await fn(shim);
        db.exec("commit");
        return result;
      } catch (err) {
        db.exec("rollback");
        throw err;
      }
    },
  };
  return shim;
}

runStorageTests({
  name: "@postel/prisma (sqlite shim)",
  expectedSchemaVersion: 4,
  capabilities: { notify: false, txIsolation: false },
  async create() {
    const clock = makeFakeClock();
    const db = new Database(":memory:");
    return {
      storage: PrismaStorage({ prisma: prismaShim(db), dialect: "sqlite", clock }),
      clock,
    };
  },
});
