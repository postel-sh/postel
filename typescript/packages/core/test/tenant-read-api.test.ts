import { describe, expect, it } from "vitest";

import type { Clock } from "../src/clock.js";
import { Postel } from "../src/postel.js";
import { InMemoryStorage } from "../src/storage/memory/adapter.js";

function mutableClock(
  start = new Date("2026-07-01T00:00:00.000Z"),
): Clock & { set: (d: Date) => void } {
  let current = start;
  return {
    now: () => current,
    sleep: async () => {},
    set: (d: Date) => {
      current = d;
    },
  };
}

function setup(clock?: Clock) {
  const storage = InMemoryStorage(clock ? { clock } : {});
  const postel = Postel({ outbound: { storage, ...(clock ? { clock } : {}) } });
  return { storage, postel };
}

describe("Read a tenant by id", () => {
  it("Get an existing tenant returns its rate limit and metadata", async () => {
    const { postel } = setup();
    await postel.outbound.tenants.setRateLimit("t_1", { perSecond: 50 });

    const tenant = await postel.outbound.tenants.get("t_1");
    expect(tenant?.id).toBe("t_1");
    expect(tenant?.rateLimit).toEqual({ kind: "fixed", perSecond: 50 });
    expect(tenant?.createdAt).toBeInstanceOf(Date);
  });

  it("Get a missing tenant resolves absent (undefined, no throw)", async () => {
    const { postel } = setup();
    await expect(postel.outbound.tenants.get("t_does_not_exist")).resolves.toBeUndefined();
  });

  it("Legacy bare rate-limit shape still decodes", async () => {
    const { storage, postel } = setup();
    await storage.tenants.upsert("t_legacy", { rateLimit: { perSecond: 25 } });

    const tenant = await postel.outbound.tenants.get("t_legacy");
    expect(tenant?.rateLimit).toEqual({ kind: "fixed", perSecond: 25 });
  });

  it("A tenant with no rate limit configured has a null rateLimit", async () => {
    const { storage, postel } = setup();
    await storage.tenants.upsert("t_bare", null);

    const tenant = await postel.outbound.tenants.get("t_bare");
    expect(tenant?.rateLimit).toBeNull();
  });
});

describe("List tenants (paginated)", () => {
  it("List returns tenants newest-first", async () => {
    const clock = mutableClock();
    const { storage, postel } = setup(clock);
    clock.set(new Date("2026-07-01T10:00:00.000Z"));
    await storage.tenants.upsert("t_1", null);
    clock.set(new Date("2026-07-01T11:00:00.000Z"));
    await storage.tenants.upsert("t_2", null);
    clock.set(new Date("2026-07-01T12:00:00.000Z"));
    await storage.tenants.upsert("t_3", null);

    const page = await postel.outbound.tenants.list();
    expect(page.items.map((t) => t.id)).toEqual(["t_3", "t_2", "t_1"]);
    expect(page.nextCursor).toBeNull();
  });

  it("Limit bounds the page size", async () => {
    const { storage, postel } = setup();
    for (let i = 0; i < 5; i += 1) {
      await storage.tenants.upsert(`t_${i}`, null);
    }
    const page = await postel.outbound.tenants.list({ limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
  });

  it("Cursor pagination walks the full set without gaps or duplicates", async () => {
    const clock = mutableClock();
    const { storage, postel } = setup(clock);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      clock.set(new Date(clock.now().getTime() + 1000));
      await storage.tenants.upsert(`t_${i}`, null);
      ids.push(`t_${i}`);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await postel.outbound.tenants.list({
        limit: 2,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      seen.push(...page.items.map((t) => t.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    expect(seen).toEqual([...ids].reverse());
  });

  it("Empty store returns an empty page", async () => {
    const { postel } = setup();
    const page = await postel.outbound.tenants.list();
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("Rejects a non-positive or non-integer limit (guards LIMIT -1 unbounded reads)", async () => {
    const { postel } = setup();
    await expect(postel.outbound.tenants.list({ limit: -1 })).rejects.toThrow(/positive integer/);
    await expect(postel.outbound.tenants.list({ limit: 0 })).rejects.toThrow(/positive integer/);
    await expect(postel.outbound.tenants.list({ limit: 1.5 })).rejects.toThrow(/positive integer/);
  });

  it("Rejects a malformed cursor rather than silently returning an empty or wrong page", async () => {
    const { postel } = setup();
    await expect(postel.outbound.tenants.list({ cursor: "not-a-valid-cursor" })).rejects.toThrow();
  });
});
