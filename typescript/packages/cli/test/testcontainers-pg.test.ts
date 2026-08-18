import { describe, it } from "vitest";

import { runMigrate } from "../src/index.js";

// Real-Postgres tier. Gated on POSTEL_PG_TESTCONTAINERS (Docker required), same
// convention as @postel/pg's own testcontainers.test.ts — the CLI drives a real
// connection string, which pglite can't stand in for.
if (process.env.POSTEL_PG_TESTCONTAINERS) {
  describe("postel migrate — real Postgres", () => {
    it("Fresh database reaches current schema version", async () => {
      const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
      const { Client } = await import("pg");
      const container = await new PostgreSqlContainer("postgres:16-alpine").start();
      try {
        const url = container.getConnectionUri();
        await runMigrate(["--dialect", "postgres", "--url", url]);

        const client = new Client({ connectionString: url });
        await client.connect();
        try {
          const res = await client.query(
            "SELECT value FROM _postel_meta WHERE key = 'schema_version'",
          );
          if (Number(res.rows[0]?.value) !== 7) {
            throw new Error(`expected schema_version 7, got ${res.rows[0]?.value}`);
          }
        } finally {
          await client.end();
        }

        // Rerunning migrate is a no-op.
        await runMigrate(["--dialect", "postgres", "--url", url]);
      } finally {
        await container.stop();
      }
    }, 120_000);
  });
} else {
  describe.skip("postel migrate — real Postgres (set POSTEL_PG_TESTCONTAINERS=1, Docker, to run)", () => {
    it("skipped without Docker", () => {});
  });
}
