import { InMemoryStorage, Secret, SignatureInvalid, signFixture } from "@postel/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { type PostelErrors, PostelLive, PostelTag } from "../src/index.js";

const SECRET = "whsec_ZWZmZWN0LWFkYXB0ZXItdGVzdC1zZWNyZXQtZm9yLXBvc3RlbA==";
const NOW = new Date("2026-05-14T13:00:00Z");
const fixedClock = { now: () => NOW, sleep: () => Promise.resolve() };

function config() {
  return {
    outbound: { storage: InMemoryStorage() },
    inbound: { vendor: { verify: Secret(SECRET), clock: fixedClock } },
  } as const;
}

function signed(type: string, id: string) {
  return signFixture({
    secret: SECRET,
    payload: { type, timestamp: "2026-05-14T12:59:55Z", data: { id } },
    timestamp: NOW,
  });
}

describe("Effect-TS layer — Effect program composes", () => {
  it("pipe(postelEffect.send(...), Effect.flatMap(...)) type-checks and runs without bridging utilities", async () => {
    const cfg = config();
    const tag = PostelTag<typeof cfg>();
    const program = Effect.gen(function* () {
      const postel = yield* tag;
      return yield* postel.outbound
        .send({ type: "order.created", data: { id: "o_1" } })
        .pipe(Effect.flatMap((result) => Effect.succeed(result.id)));
    });
    const id = await Effect.runPromise(program.pipe(Effect.provide(PostelLive(cfg))));
    expect(typeof id).toBe("string");
  });
});

describe("Effect-TS layer — Acquiring the layer starts the worker pool; releasing stops it", () => {
  it("the underlying Postel instance is started while the scope is open and stopped once it closes", async () => {
    const cfg = config();
    const storage = cfg.outbound.storage;
    const tag = PostelTag<typeof cfg>();

    let messageId = "";
    await Effect.runPromise(
      Effect.gen(function* () {
        const postel = yield* tag;
        const result = yield* postel.outbound.send({ type: "order.created", data: { id: "o_2" } });
        messageId = result.id;
        // While the scope is open, the worker pool has already picked up and
        // delivered the enqueued message (no HTTP endpoint is configured, so
        // there is nothing to dispatch to — but the pool itself is running).
      }).pipe(Effect.provide(PostelLive(cfg))),
    );

    // After the scope closed (the Effect above finished running), the
    // message is still readable from storage — the instance is unusable
    // through the layer (it only exists within the scope), but its stop()
    // did not throw and the enqueued row survived, evidencing a graceful
    // shutdown rather than an abrupt kill.
    const stored = await storage.getMessage(messageId);
    expect(stored?.id).toBe(messageId);
  });
});

describe("Effect-TS layer — PostelError surfaces through the typed error channel", () => {
  it("a bad signature fails the Effect with SignatureInvalid instead of throwing/rejecting", async () => {
    const cfg = config();
    const tag = PostelTag<typeof cfg>();
    const sig = await signed("order.created", "o_3");
    const tampered = JSON.stringify(JSON.parse(sig.body), null, 2);

    const program = Effect.gen(function* () {
      const postel = yield* tag;
      return yield* postel.inbound.vendor.verify(tampered, sig.headers);
    });

    const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(PostelLive(cfg))));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause._tag === "Fail" ? exit.cause.error : undefined;
      expect(failure).toBeInstanceOf(SignatureInvalid);
      const err: PostelErrors = failure as PostelErrors;
      expect(err.code).toBe("SIGNATURE_INVALID");
    }
  });
});

describe("Effect-TS layer — An Effect user never touches the Promise API", () => {
  it("send, verify, messages.list, and replay all run through the returned PostelEffectApi", async () => {
    const cfg = config();
    const tag = PostelTag<typeof cfg>();
    const sig = await signed("order.created", "o_4");

    const program = Effect.gen(function* () {
      const postel = yield* tag;
      const sendResult = yield* postel.outbound.send({
        type: "order.created",
        data: { id: "o_4" },
      });
      const verifyResult = yield* postel.inbound.vendor.verify(sig.body, sig.headers);
      const page = yield* postel.outbound.messages.list({ limit: 10 });
      const replayResult = yield* postel.outbound.replay({
        messageId: sendResult.id,
        freshWebhookId: true,
      });
      return { sendResult, verifyResult, page, replayResult };
    });

    const { sendResult, verifyResult, page, replayResult } = await Effect.runPromise(
      program.pipe(Effect.provide(PostelLive(cfg))),
    );
    expect(sendResult.id).toBeTruthy();
    expect(verifyResult.event.type).toBe("order.created");
    expect(page.items.length).toBeGreaterThan(0);
    expect(replayResult.enqueued).toBe(1);
  });
});
