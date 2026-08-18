import "reflect-metadata";
import { type ExecutionContext, HttpException } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants.js";
import {
  ConfigurationError,
  InMemoryDedup,
  NotImplementedError,
  Postel,
  Secret,
  signFixture,
} from "@postel/core";
import { describe, expect, it } from "vitest";

import {
  Event,
  NestjsWebAdapter,
  POSTEL_INSTANCE,
  PostelModule,
  WebhookGuard,
  WebhookResult,
} from "../src/index.js";

const fixedClock = (at: Date) => ({ now: () => at, sleep: () => Promise.resolve() });

const SECRET = "whsec_aG9uby1hZGFwdGVyLXRlc3Qtc2VjcmV0LWZvci1wb3N0ZWw=";
const NOW = new Date("2026-05-14T13:00:00Z");

function vendor() {
  return Postel({ inbound: { vendor: { verify: Secret(SECRET), clock: fixedClock(NOW) } } });
}

function dedupVendor() {
  return Postel({
    inbound: {
      vendor: { verify: Secret(SECRET), clock: fixedClock(NOW), dedup: InMemoryDedup() },
    },
  });
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

describe("Consumed raw body surfaces a descriptive configuration error [PORT-SPECIFIC]", () => {
  it("NestJS WebhookGuard without rawBody enabled", async () => {
    const Guard = WebhookGuard("vendor");
    const guard = new Guard(vendor());
    const sig = await signed("order.created", "o_1");
    // No `rawBody: true` at bootstrap: `req.rawBody` is absent and `req.body`
    // is the already-parsed body from Nest's global body parser.
    const req = { body: JSON.parse(sig.body), headers: { ...sig.headers }, method: "POST" };
    let caught: unknown;
    try {
      await guard.canActivate(ctx(req));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigurationError);
    expect((caught as Error).message).toMatch(/rawBody/);
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

describe("WebhookGuard error mapping", () => {
  it("throws a plain Error, not an HttpException, when the configured inbound source doesn't exist", async () => {
    const Guard = WebhookGuard("missing");
    const guard = new Guard(vendor());
    const req = { rawBody: "{}", headers: {}, method: "POST" };
    let caught: unknown;
    try {
      await guard.canActivate(ctx(req));
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeInstanceOf(HttpException);
    expect((caught as Error).message).toBe('WebhookGuard: no inbound source "missing" configured');
  });

  it("maps a missing-signature-header failure to an HttpException carrying the MALFORMED_HEADER code", async () => {
    const Guard = WebhookGuard("vendor");
    const guard = new Guard(vendor());
    const req = { rawBody: "{}", headers: {}, method: "POST" };
    let caught: unknown;
    try {
      await guard.canActivate(ctx(req));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(400);
    expect((caught as HttpException).getResponse()).toMatchObject({
      error: { code: "MALFORMED_HEADER" },
    });
  });

  it("maps a dedup 'duplicate' outcome to an HttpException carrying the outcome's status", async () => {
    const Guard = WebhookGuard("vendor", { dedup: { ttl: "1h" } });
    const guard = new Guard(dedupVendor());
    const sig = await signed("order.created", "o_dup");
    const req = { rawBody: sig.body, headers: { ...sig.headers }, method: "POST" };
    const allowed = await guard.canActivate(ctx(req));
    expect(allowed).toBe(true);

    let caught: unknown;
    try {
      await guard.canActivate(ctx({ ...req, headers: { ...sig.headers } }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(200);
    expect((caught as HttpException).getResponse()).toEqual({});
  });
});

describe("Event and WebhookResult param decorators", () => {
  function extractFactory(decorator: () => ParameterDecorator) {
    class Probe {
      method(_value: unknown) {
        return _value;
      }
    }
    decorator()(Probe.prototype, "method", 0);
    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, "method") as Record<
      string,
      { factory: (data: unknown, context: ExecutionContext) => unknown }
    >;
    const [entry] = Object.values(metadata);
    if (!entry) throw new Error("no param metadata recorded for decorator");
    return entry.factory;
  }

  it("Event() resolves to the verified event carried on req.postel", async () => {
    const Guard = WebhookGuard("vendor");
    const guard = new Guard(vendor());
    const sig = await signed("order.created", "o_1");
    const req: {
      rawBody: string;
      headers: Record<string, string>;
      method: string;
      postel?: unknown;
    } = { rawBody: sig.body, headers: { ...sig.headers }, method: "POST" };
    await guard.canActivate(ctx(req));
    const factory = extractFactory(Event);
    expect(factory(undefined, ctx(req))).toEqual((req.postel as { event: unknown }).event);
  });

  it("WebhookResult() resolves to the full verified result carried on req.postel", async () => {
    const Guard = WebhookGuard("vendor");
    const guard = new Guard(vendor());
    const sig = await signed("order.created", "o_2");
    const req: {
      rawBody: string;
      headers: Record<string, string>;
      method: string;
      postel?: unknown;
    } = { rawBody: sig.body, headers: { ...sig.headers }, method: "POST" };
    await guard.canActivate(ctx(req));
    const factory = extractFactory(WebhookResult);
    expect(factory(undefined, ctx(req))).toBe(req.postel);
  });
});

describe("PostelModule", () => {
  it("forRoot registers the Postel instance as a global provider under POSTEL_INSTANCE", () => {
    const postel = vendor();
    const dynamicModule = PostelModule.forRoot(postel);
    expect(dynamicModule.module).toBe(PostelModule);
    expect(dynamicModule.global).toBe(true);
    expect(dynamicModule.providers).toEqual([{ provide: POSTEL_INSTANCE, useValue: postel }]);
    expect(dynamicModule.exports).toEqual([POSTEL_INSTANCE]);
  });
});
