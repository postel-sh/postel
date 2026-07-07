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

describe("Read a message by id", () => {
  it("Get an existing message returns metadata and payload", async () => {
    const { postel } = setup();
    const { id } = await postel.outbound.send({ type: "order.created", data: { orderId: "o1" } });

    const message = await postel.outbound.messages.get(id);
    expect(message?.id).toBe(id);
    expect(message?.type).toBe("order.created");
    expect(message?.data).toEqual({ orderId: "o1" });
    expect(message?.status).toBe("pending");
    expect(message?.createdAt).toBeInstanceOf(Date);
  });

  it("Get a missing message resolves absent (undefined, no throw)", async () => {
    const { postel } = setup();
    await expect(postel.outbound.messages.get("msg_does_not_exist")).resolves.toBeUndefined();
  });
});

describe("List a message's delivery attempts", () => {
  it("Attempts are returned ordered with status, code, and latency", async () => {
    const { storage, postel } = setup();
    const { id } = await postel.outbound.send({ type: "order.created", data: { orderId: "o1" } });
    await storage.recordAttempt({
      id: "att_2",
      messageId: id,
      endpointId: "ep_1",
      tenantId: null,
      attemptNumber: 2,
      status: "success",
      scheduledFor: null,
      startedAt: new Date(),
      completedAt: new Date(),
      responseCode: 200,
      responseHeaders: null,
      responseBody: null,
      latencyMs: 15,
      error: null,
      replayOf: null,
    });
    await storage.recordAttempt({
      id: "att_1",
      messageId: id,
      endpointId: "ep_1",
      tenantId: null,
      attemptNumber: 1,
      status: "failed",
      scheduledFor: null,
      startedAt: new Date(),
      completedAt: new Date(),
      responseCode: 500,
      responseHeaders: null,
      responseBody: null,
      latencyMs: 40,
      error: "boom",
      replayOf: null,
    });

    const attempts = await postel.outbound.messages.attempts(id);
    expect(attempts.map((a) => a.attemptNumber)).toEqual([1, 2]);
    expect(attempts[0]?.status).toBe("failed");
    expect(attempts[0]?.responseCode).toBe(500);
    expect(attempts[1]?.status).toBe("success");
    expect(attempts[1]?.latencyMs).toBe(15);
    expect(attempts[1]?.endpointId).toBe("ep_1");
  });

  it("Replay attempts carry the replay tag", async () => {
    const { storage, postel } = setup();
    const { id: original } = await postel.outbound.send({
      type: "order.created",
      data: { orderId: "o1" },
    });
    const { id: replayId } = await postel.outbound.send({
      type: "order.created",
      data: { orderId: "o1" },
    });
    await storage.recordAttempt({
      id: "att_replay",
      messageId: replayId,
      endpointId: "ep_1",
      tenantId: null,
      attemptNumber: 1,
      status: "success",
      scheduledFor: null,
      startedAt: new Date(),
      completedAt: new Date(),
      responseCode: 200,
      responseHeaders: null,
      responseBody: null,
      latencyMs: 10,
      error: null,
      replayOf: original,
    });

    const attempts = await postel.outbound.messages.attempts(replayId);
    expect(attempts[0]?.replayOf).toBe(original);
  });

  it("Unknown message yields an empty attempt list", async () => {
    const { postel } = setup();
    await expect(postel.outbound.messages.attempts("msg_none")).resolves.toEqual([]);
  });
});

describe("List and filter messages", () => {
  it("Filter by type and time window, newest-first", async () => {
    const clock = mutableClock();
    const { postel } = setup(clock);
    clock.set(new Date("2026-07-01T10:00:00.000Z"));
    await postel.outbound.send({ type: "order.created", data: { n: 1 } });
    clock.set(new Date("2026-07-01T11:00:00.000Z"));
    const { id: second } = await postel.outbound.send({ type: "order.created", data: { n: 2 } });
    clock.set(new Date("2026-07-01T12:00:00.000Z"));
    await postel.outbound.send({ type: "user.deleted" });

    const listed = await postel.outbound.messages.list({
      types: ["order.created"],
      since: new Date("2026-07-01T10:30:00.000Z"),
    });
    expect(listed.items.map((m) => m.type)).toEqual(["order.created"]);
    expect(listed.items[0]?.id).toBe(second);
  });

  it("Filter by outbox status", async () => {
    const { storage, postel } = setup();
    const { id: dispatched } = await postel.outbound.send({
      type: "order.created",
      data: { n: 1 },
    });
    await postel.outbound.send({ type: "order.created", data: { n: 2 } });
    await storage.markMessageFinal(dispatched, "dispatched");

    const listed = await postel.outbound.messages.list({ status: "dispatched" });
    expect(listed.items.map((m) => m.id)).toEqual([dispatched]);
  });

  it("Tenant scoping restricts results", async () => {
    const storage = InMemoryStorage();
    const t1 = Postel({ outbound: { storage, defaultTenantId: "t_1" } });
    const t2 = Postel({ outbound: { storage, defaultTenantId: "t_2" } });
    await t1.outbound.send({ type: "order.created", data: { n: 1 } });
    await t2.outbound.send({ type: "order.created", data: { n: 2 } });

    const scoped = await t1.outbound.messages.list({ tenantId: "t_1" });
    expect(scoped.items).toHaveLength(1);
    expect(scoped.items.every((m) => m.tenantId === "t_1")).toBe(true);
  });

  it("Limit bounds the result count", async () => {
    const { postel } = setup();
    for (let i = 0; i < 5; i += 1) {
      await postel.outbound.send({ type: "order.created", data: { i } });
    }
    const listed = await postel.outbound.messages.list({ limit: 2 });
    expect(listed.items).toHaveLength(2);
    expect(listed.nextCursor).not.toBeNull();
  });

  it("Cursor pagination walks the full set without gaps or duplicates", async () => {
    const clock = mutableClock();
    const { postel } = setup(clock);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      clock.set(new Date(Date.parse("2026-07-01T10:00:00.000Z") + i * 1000));
      const { id } = await postel.outbound.send({ type: "order.created", data: { i } });
      ids.push(id);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await postel.outbound.messages.list({
        limit: 2,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      seen.push(...page.items.map((m) => m.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(seen).toEqual([...ids].reverse());
  });

  it("A malformed cursor is rejected with a structured error", async () => {
    const { postel } = setup();
    await expect(postel.outbound.messages.list({ cursor: "not-a-cursor" })).rejects.toThrow(
      TypeError,
    );
  });

  it("Rejects a malformed since/until date rather than passing an Invalid Date to storage", async () => {
    const { postel } = setup();
    await expect(postel.outbound.messages.list({ since: "not-a-date" })).rejects.toThrow(
      /invalid date/,
    );
    await expect(postel.outbound.messages.list({ until: new Date("nope") })).rejects.toThrow(
      /invalid date/,
    );
  });

  it("Rejects a non-positive or non-integer limit (guards LIMIT -1 unbounded reads)", async () => {
    const { postel } = setup();
    await expect(postel.outbound.messages.list({ limit: -1 })).rejects.toThrow(/positive integer/);
    await expect(postel.outbound.messages.list({ limit: 0 })).rejects.toThrow(/positive integer/);
    await expect(postel.outbound.messages.list({ limit: 1.5 })).rejects.toThrow(/positive integer/);
  });
});
