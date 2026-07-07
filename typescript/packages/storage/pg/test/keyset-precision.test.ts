import { PGlite } from "@electric-sql/pglite";
import type { NewMessage } from "@postel/core";
import { makeFakeClock } from "@postel/storage-testkit";
import { describe, expect, it } from "vitest";

import { PgStorage } from "../src/index.js";
import { pgliteShim } from "./pglite-shim.js";

function message(id: string, createdAt: Date): NewMessage {
  return {
    id,
    tenantId: null,
    type: "order.created",
    data: { id },
    channels: null,
    idempotencyKey: null,
    version: null,
    ttlSeconds: null,
    createdAt,
    expiresAt: null,
  };
}

// Audit regression (#84 / PR #107): the keyset cursor encodes millisecond
// ISO-8601, but an unpinned `timestamptz` column holds microseconds — rows
// nudged to sub-ms offsets fell between page boundaries (a 5-row walk returned
// 3). `timestamptz(3)` in the canonical schema rounds sub-ms writes to the
// millisecond, so stored values round-trip the cursor exactly.
describe("BYO storage interface — keyset timestamp precision (ADR 0015)", () => {
  it("a paginated walk survives sub-ms created_at writes: timestamptz(3) rounds them to cursor precision", async () => {
    const clock = makeFakeClock();
    const raw = new PGlite();
    const pool = pgliteShim(raw);
    const storage = PgStorage({ pool, clock });

    const base = clock.now();
    const ids = ["msg_p_1", "msg_p_2", "msg_p_3", "msg_p_4", "msg_p_5"];
    for (const [i, id] of ids.entries()) {
      await storage.insertMessage(message(id, new Date(base.getTime() + i * 1000)));
    }
    // Nudge two rows to sub-ms offsets the way a SQL backfill (or a µs-writing
    // port) would — bypassing the library's ms-valued Date writes entirely.
    await raw.query(
      "UPDATE messages SET created_at = created_at + interval '0.4 milliseconds' WHERE id = 'msg_p_2'",
    );
    await raw.query(
      "UPDATE messages SET created_at = created_at + interval '0.6 milliseconds' WHERE id = 'msg_p_4'",
    );

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await storage.listMessages({
        limit: 2,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      seen.push(...page.items.map((m) => m.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect(seen.length).toBe(ids.length);
    expect(new Set(seen)).toEqual(new Set(ids));
  });
});
