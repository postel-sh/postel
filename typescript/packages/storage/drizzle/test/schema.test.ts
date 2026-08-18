import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";

import { DrizzleStorage } from "../src/index.js";
import { sqliteEndpoints, sqliteTenants } from "../src/schema.js";

// Requirement: Migrations runnable from CLI and programmatic API
// Scenario: ORM schema generation
describe("@postel/drizzle/schema", () => {
  it("ORM schema generation: sqlite tables round-trip against the migrated schema", async () => {
    const db = drizzle(new Database(":memory:"));
    // autoMigrate creates the physical tables through DrizzleStorage's own
    // raw-SQL migration path; the schema fragment must describe those same
    // tables/columns for a host to merge it in.
    await DrizzleStorage({ db, dialect: "sqlite" }).schemaVersion();

    await db.insert(sqliteTenants).values({ id: "t1", createdAt: new Date().toISOString() });
    const tenantRows = await db.select().from(sqliteTenants);
    expect(tenantRows).toEqual([{ id: "t1", metadata: null, createdAt: expect.any(String) }]);

    const now = new Date().toISOString();
    await db.insert(sqliteEndpoints).values({
      id: "e1",
      tenantId: "t1",
      url: "https://example.com/hook",
      createdAt: now,
      updatedAt: now,
    });
    const endpointRows = await db.select().from(sqliteEndpoints);
    expect(endpointRows).toHaveLength(1);
    expect(endpointRows[0]?.url).toBe("https://example.com/hook");
    expect(endpointRows[0]?.tenantId).toBe("t1");
  });
});
