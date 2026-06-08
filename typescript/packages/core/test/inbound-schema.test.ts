import { describe, expect, it } from "vitest";
import { z } from "zod";

import { EventValidation, Postel, Secret, signFixture } from "../src/index.js";

const SECRET = "whsec_aG9uby1hZGFwdGVyLXRlc3Qtc2VjcmV0LWZvci1wb3N0ZWw=";
const NOW = new Date("2026-05-14T13:00:00Z");

function signed(data: unknown) {
  return signFixture({
    secret: SECRET,
    payload: { type: "order.created", timestamp: "2026-05-14T12:59:55Z", data },
    timestamp: NOW,
  });
}

describe("Per-source event schema validation", () => {
  it("a valid payload passes and verified data is typed as the schema output", async () => {
    const postel = Postel({
      inbound: {
        orders: {
          verify: Secret(SECRET),
          schema: z.object({ id: z.string(), total: z.number() }),
          now: () => NOW,
        },
      },
    });
    const sig = await signed({ id: "o_1", total: 42 });
    const result = await postel.inbound.orders.verify(sig.body, { ...sig.headers });

    // Compile-time proof that `const` inference carries the schema's output type
    // through to the verified result: if EventOf resolved to `unknown`, this
    // assignment would not type-check.
    const data: { id: string; total: number } | undefined = result.event.data;
    expect(data).toEqual({ id: "o_1", total: 42 });
  });

  it("a payload that fails the schema throws EventValidation after the signature check", async () => {
    const postel = Postel({
      inbound: {
        orders: { verify: Secret(SECRET), schema: z.object({ id: z.string() }), now: () => NOW },
      },
    });
    const sig = await signed({ id: 123 });
    await expect(postel.inbound.orders.verify(sig.body, { ...sig.headers })).rejects.toBeInstanceOf(
      EventValidation,
    );
  });

  it("EventValidation carries the schema issues and the EVENT_VALIDATION code", async () => {
    const postel = Postel({
      inbound: {
        orders: { verify: Secret(SECRET), schema: z.object({ id: z.string() }), now: () => NOW },
      },
    });
    const sig = await signed({ id: 123 });
    let caught: unknown;
    try {
      await postel.inbound.orders.verify(sig.body, { ...sig.headers });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EventValidation);
    expect((caught as EventValidation).code).toBe("EVENT_VALIDATION");
    expect((caught as EventValidation).issues.length).toBeGreaterThan(0);
  });

  it("a source without a schema verifies unchanged", async () => {
    const postel = Postel({ inbound: { raw: { verify: Secret(SECRET), now: () => NOW } } });
    const sig = await signed({ anything: true });
    const result = await postel.inbound.raw.verify(sig.body, { ...sig.headers });
    expect(result.event.type).toBe("order.created");
    expect(result.event.data).toEqual({ anything: true });
  });
});
