import { describe, expect, it } from "vitest";
import { z } from "zod";

import { EventValidation, Postel } from "../src/index.js";
import { InMemoryStorage } from "../src/storage/memory/adapter.js";

function setup() {
  const storage = InMemoryStorage({});
  const postel = Postel({
    outbound: {
      storage,
      events: {
        "user.created": z.object({ id: z.string() }),
      },
    },
  });
  return { storage, postel };
}

// A stand-in for data arriving from outside the type system (e.g. read back
// from JSON.parse or an untyped upstream) — its static `type` widens to
// `string`, which is what actually exercises `send()`'s runtime validation
// path. A literal `{ type: "user.created", data: { id: 123 } }` now fails at
// COMPILE time (the registered schema requires `id: string`), which is the
// point of the registry — this helper is only for proving the runtime check
// still backs that up for values TypeScript can't see through statically.
function fromUntypedSource(): { readonly type: string; readonly data?: unknown } {
  return { type: "user.created", data: { id: 123 } };
}

describe("Per-type event schema validation on send", () => {
  it("Registered type with valid data persists normally", async () => {
    const { postel } = setup();
    const { id } = await postel.outbound.send({ type: "user.created", data: { id: "u_1" } });

    const message = await postel.outbound.messages.get(id);
    expect(message?.data).toEqual({ id: "u_1" });
  });

  it("Registered type with invalid data is rejected before persistence", async () => {
    const { postel } = setup();

    await expect(postel.outbound.send(fromUntypedSource())).rejects.toBeInstanceOf(EventValidation);

    const page = await postel.outbound.messages.list();
    expect(page.items).toHaveLength(0);
  });

  it("EventValidation carries the schema issues and the EVENT_VALIDATION code", async () => {
    const { postel } = setup();
    let caught: unknown;
    try {
      await postel.outbound.send(fromUntypedSource());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EventValidation);
    expect((caught as EventValidation).code).toBe("EVENT_VALIDATION");
    expect((caught as EventValidation).issues.length).toBeGreaterThan(0);
  });

  it("Unregistered type is fully permissive", async () => {
    const { postel } = setup();
    const { id } = await postel.outbound.send({
      type: "some.unregistered.type",
      data: { anything: true },
    });

    const message = await postel.outbound.messages.get(id);
    expect(message?.data).toEqual({ anything: true });
  });

  it("no events registry configured leaves send() unchanged", async () => {
    const storage = InMemoryStorage({});
    const postel = Postel({ outbound: { storage } });
    const { id } = await postel.outbound.send({ type: "user.created", data: { id: 123 } });

    const message = await postel.outbound.messages.get(id);
    expect(message?.data).toEqual({ id: 123 });
  });

  it("explicit send<TData> generic still compiles and runs for an unregistered type", async () => {
    const { postel } = setup();
    interface OrderCreated {
      readonly orderId: string;
    }
    const { id } = await postel.outbound.send<OrderCreated>({
      type: "order.created",
      data: { orderId: "o_1" },
    });

    const message = await postel.outbound.messages.get(id);
    expect(message?.data).toEqual({ orderId: "o_1" });
  });
});
