import { describe, expect, it } from "vitest";
import { Postel } from "../src/index.js";

import { InMemoryStorage, type InMemoryTx } from "../src/index.js";

// These tests are primarily compile-time assertions: the package tsconfig
// includes test/**/*, so a `@ts-expect-error` that fails to error (or a
// genuine type error in the positive cases) fails `pnpm typecheck`. The
// runtime `expect(true)` keeps vitest happy.

describe("All writes accept an optional transaction parameter", () => {
  it("send() tx is typed as the configured adapter's transaction handle", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });

    // Positive: the tx handed to a storage.transaction callback is InMemoryTx,
    // and send() accepts exactly that type — no cast, no `unknown`.
    await storage.transaction(async (tx: InMemoryTx) => {
      await postel.outbound.send({ type: "order.created" }, { tx });
    });

    expect(typeof postel.outbound.send).toBe("function");
  });

  it("send() rejects a tx that is not the configured adapter's handle", () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });

    // Negative: a foreign tx handle (e.g. a pg PoolClient stand-in) is a
    // compile error — the type follows the chosen storage adapter.
    void (() =>
      postel.outbound.send(
        { type: "order.created" },
        // @ts-expect-error tx must be InMemoryTx, not an arbitrary object
        { tx: { query: () => undefined } },
      ));

    expect(typeof postel.outbound.send).toBe("function");
  });

  it("endpoints + tenants writes carry the same tx type", async () => {
    const storage = InMemoryStorage();
    const postel = Postel({ outbound: { storage } });

    await storage.transaction(async (tx: InMemoryTx) => {
      await postel.outbound.tenants.setRateLimit("t_42", { perSecond: 10, tx });
    });

    void (() =>
      postel.outbound.endpoints.delete(
        "ep_x",
        // @ts-expect-error tx must be InMemoryTx
        { tx: 123 },
      ));

    expect(typeof postel.outbound.tenants.setRateLimit).toBe("function");
  });
});
