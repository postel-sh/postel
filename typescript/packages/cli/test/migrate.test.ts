import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runMigrate } from "../src/index.js";

// Requirement: `postel migrate` brings a database to the current schema version
describe("postel migrate", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "postel-cli-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("Missing a required flag fails fast: --dialect", async () => {
    await expect(runMigrate(["--url", ":memory:"])).rejects.toThrow(/--dialect/);
  });

  it("Missing a required flag fails fast: --url", async () => {
    await expect(runMigrate(["--dialect", "sqlite"])).rejects.toThrow(/--url/);
  });

  it("Unsupported dialect fails fast", async () => {
    await expect(runMigrate(["--dialect", "oracle", "--url", ":memory:"])).rejects.toThrow(
      /oracle/,
    );
  });

  it("Fresh database reaches current schema version", async () => {
    const file = join(dir, "postel.db");
    await runMigrate(["--dialect", "sqlite", "--url", file]);

    const db = new Database(file);
    try {
      const row = db
        .prepare("SELECT value FROM _postel_meta WHERE key = 'schema_version'")
        .get() as {
        value: string;
      };
      expect(Number(row.value)).toBe(7);
    } finally {
      db.close();
    }
  });

  it("Rerunning migrate is a no-op", async () => {
    const file = join(dir, "postel.db");
    await runMigrate(["--dialect", "sqlite", "--url", file]);
    await expect(runMigrate(["--dialect", "sqlite", "--url", file])).resolves.toBeUndefined();

    const db = new Database(file);
    try {
      const row = db
        .prepare("SELECT value FROM _postel_meta WHERE key = 'schema_version'")
        .get() as {
        value: string;
      };
      expect(Number(row.value)).toBe(7);
    } finally {
      db.close();
    }
  });
});
