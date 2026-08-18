import { describe, it } from "vitest";

import { runMigrate } from "../src/index.js";

// Real-MySQL tier, same convention as the MySQL-targeting adapters:
// POSTEL_MYSQL_TESTCONTAINERS (local Docker) or POSTEL_MYSQL_URL (CI service
// container) via @postel/storage-testkit's startMysqlContainer.
if (process.env.POSTEL_MYSQL_TESTCONTAINERS || process.env.POSTEL_MYSQL_URL) {
  describe("postel migrate — real MySQL", () => {
    it("Fresh database reaches current schema version", async () => {
      const { startMysqlContainer } = await import("@postel/storage-testkit");
      const { createPool } = await import("mysql2/promise");
      const { uri, stop } = await startMysqlContainer();
      try {
        await runMigrate(["--dialect", "mysql", "--url", uri]);

        const pool = createPool(uri);
        try {
          const [rows] = await pool.query(
            "SELECT value FROM _postel_meta WHERE `key` = 'schema_version'",
          );
          const value = (rows as Array<{ value: string }>)[0]?.value;
          if (Number(value) !== 7) throw new Error(`expected schema_version 7, got ${value}`);
        } finally {
          await pool.end();
        }

        // Rerunning migrate is a no-op.
        await runMigrate(["--dialect", "mysql", "--url", uri]);
      } finally {
        await stop();
      }
    }, 120_000);
  });
} else {
  describe.skip("postel migrate — real MySQL (set POSTEL_MYSQL_TESTCONTAINERS=1, Docker, to run)", () => {
    it("skipped without Docker", () => {});
  });
}
