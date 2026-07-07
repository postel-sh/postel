import "reflect-metadata";
import { type ExecutionContext, HttpException } from "@nestjs/common";
import { NotImplementedError, Postel, Secret, signFixture } from "@postel/core";
import { describe, expect, it } from "vitest";

import { NestjsWebAdapter, WebhookGuard } from "../src/index.js";

const fixedClock = (at: Date) => ({ now: () => at, sleep: () => Promise.resolve() });

const SECRET = "whsec_aG9uby1hZGFwdGVyLXRlc3Qtc2VjcmV0LWZvci1wb3N0ZWw=";
const NOW = new Date("2026-05-14T13:00:00Z");

function vendor() {
  return Postel({ inbound: { vendor: { verify: Secret(SECRET), clock: fixedClock(NOW) } } });
}

function signed(type: string, id: string) {
  return signFixture({
    secret: SECRET,
    payload: { type, timestamp: "2026-05-14T12:59:55Z", data: { id } },
    timestamp: NOW,
  });
}

function ctx(req: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe("Framework adapters preserve raw bytes", () => {
  it("NestJS adapter preserves bytes: WebhookGuard verifies byte-identical input and sets req.postel", async () => {
    const Guard = WebhookGuard("vendor");
    const guard = new Guard(vendor());
    const sig = await signed("order.created", "o_1");
    const req: {
      rawBody: string;
      headers: Record<string, string>;
      method: string;
      postel?: unknown;
    } = {
      rawBody: sig.body,
      headers: { ...sig.headers },
      method: "POST",
    };
    const allowed = await guard.canActivate(ctx(req));
    expect(allowed).toBe(true);
    expect((req.postel as { event: { type: string } }).event.type).toBe("order.created");
  });

  it("WebhookGuard rejects a bad signature with an HttpException carrying status 400", async () => {
    const Guard = WebhookGuard("vendor");
    const guard = new Guard(vendor());
    const sig = await signed("order.created", "o_2");
    const reSerialized = JSON.stringify(JSON.parse(sig.body), null, 2);
    const req = { rawBody: reSerialized, headers: { ...sig.headers }, method: "POST" };
    let caught: unknown;
    try {
      await guard.canActivate(ctx(req));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(400);
  });

  it("a non-PostelError from verification bubbles rather than becoming an HttpException", async () => {
    const Guard = WebhookGuard("vendor");
    const fakePostel = {
      inbound: {
        vendor: {
          verify: async () => {
            throw new NotImplementedError("verify");
          },
        },
      },
    };
    const guard = new Guard(fakePostel as never);
    const req = { rawBody: "{}", headers: {}, method: "POST" };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(NotImplementedError);
  });
});

describe("NestjsWebAdapter", () => {
  it("NestjsWebAdapter(postel).WebhookGuard(key) builds a typed guard for the configured source", async () => {
    const { WebhookGuard: TypedGuard } = NestjsWebAdapter(vendor());
    const Guard = TypedGuard("vendor");
    const guard = new Guard(vendor());
    const sig = await signed("order.created", "o_1");
    const req: {
      rawBody: string;
      headers: Record<string, string>;
      method: string;
      postel?: unknown;
    } = { rawBody: sig.body, headers: { ...sig.headers }, method: "POST" };
    const allowed = await guard.canActivate(ctx(req));
    expect(allowed).toBe(true);
    expect((req.postel as { event: { type: string } }).event.type).toBe("order.created");
  });
});
