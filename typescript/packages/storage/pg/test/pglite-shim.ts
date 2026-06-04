import type { PGlite } from "@electric-sql/pglite";

import type { PgPool, PgPoolClient, PgQueryResult } from "../src/index.js";

// Wrap an in-process PGlite (real Postgres in WASM) as the slice of node-postgres
// the adapter needs. PGlite is single-connection, so `connect()` hands back the
// same instance — hence the always-on tier declares notify=false and
// txIsolation=false; those guarantees need real multiple connections and are
// proven on real Postgres in testcontainers.test.ts.
export function pgliteShim(pglite: PGlite): PgPool {
  async function query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<PgQueryResult<R>> {
    if (values && values.length > 0) {
      const r = await pglite.query<R>(text, values);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    }
    const results = await pglite.exec(text);
    const last = results[results.length - 1];
    const rows = (last?.rows ?? []) as R[];
    return { rows, rowCount: last?.affectedRows ?? rows.length };
  }
  const client: PgPoolClient = { query, release() {}, on() {} };
  return { query, connect: async () => client };
}
