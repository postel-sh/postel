import { ConfigurationError, Postel, Secret, signFixture } from "@postel/core";
import { describe, expect, it } from "vitest";

import { handleInbound } from "../src/index.js";

const SECRET = "whsec_aG9uby1hZGFwdGVyLXRlc3Qtc2VjcmV0LWZvci1wb3N0ZWw=";
const NOW = new Date("2026-05-14T13:00:00Z");

function source() {
  return Postel({ inbound: { vendor: { verify: Secret(SECRET), now: () => NOW } } }).inbound.vendor;
}

function signed(type: string, id: string) {
  return signFixture({
    secret: SECRET,
    payload: { type, timestamp: "2026-05-14T12:59:55Z", data: { id } },
    timestamp: NOW,
  });
}

describe("Framework adapters gate verification and map protocol errors to HTTP status", () => {
  it("returns a verified outcome defaulting to 204 and exposes the parsed event", async () => {
    const sig = await signed("order.created", "o_1");
    const outcome = await handleInbound(source(), {
      rawBody: sig.body,
      headers: sig.headers,
      method: "POST",
    });
    expect(outcome.kind).toBe("verified");
    if (outcome.kind === "verified") {
      expect(outcome.status).toBe(204);
      expect(outcome.context.event.type).toBe("order.created");
    }
  });

  it("lets the verified handler return a custom response", async () => {
    const sig = await signed("user.created", "u_1");
    const outcome = await handleInbound(
      source(),
      { rawBody: sig.body, headers: sig.headers, method: "POST" },
      {
        onVerified: ({ event }) => ({
          status: 200,
          body: JSON.stringify({ ok: true, type: event.type }),
        }),
      },
    );
    expect(outcome.kind).toBe("verified");
    if (outcome.kind === "verified") {
      expect(outcome.status).toBe(200);
      expect(outcome.body).toBe(JSON.stringify({ ok: true, type: "user.created" }));
    }
  });

  it("maps a verification failure to a 400 error outcome (re-serialized body breaks the signature)", async () => {
    const sig = await signed("payment.captured", "p_1");
    const reSerialized = JSON.stringify(JSON.parse(sig.body), null, 2);
    const outcome = await handleInbound(source(), {
      rawBody: reSerialized,
      headers: sig.headers,
      method: "POST",
    });
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.status).toBe(400);
      expect(outcome.error.code).toBe("SIGNATURE_INVALID");
    }
  });

  it("propagates a ConfigurationError from a misconfigured source instead of mapping it to a 4xx", async () => {
    const sig = await signed("order.created", "o_3");
    const broken = Postel({ inbound: { vendor: { verify: [], now: () => NOW } } }).inbound.vendor;
    await expect(
      handleInbound(broken, { rawBody: sig.body, headers: sig.headers, method: "POST" }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("propagates a non-PostelError thrown from onVerified so the framework yields 5xx", async () => {
    const sig = await signed("order.created", "o_2");
    await expect(
      handleInbound(
        source(),
        { rawBody: sig.body, headers: sig.headers, method: "POST" },
        {
          onVerified: () => {
            throw new Error("handler boom");
          },
        },
      ),
    ).rejects.toThrow("handler boom");
  });
});
