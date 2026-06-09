import { describe, expect, it } from "vitest";

import type { Verifier } from "../src/index.js";
import { MalformedHeader, Noop, Postel, SignatureInvalid } from "../src/index.js";

const acceptingVerifier: Verifier = {
  verify: async () => ({
    event: { type: "custom.accepted", data: { ok: true } },
    matchedSecretIndex: 0,
  }),
};

const rejectingVerifier: Verifier = {
  verify: async () => {
    throw new SignatureInvalid("custom verifier rejected");
  },
};

describe("Custom verifiers and the Noop escape hatch [PORT-SPECIFIC]", () => {
  it("Custom verifier drives a source — its result flows through with matchedVerifierIndex 0", async () => {
    const postel = Postel({ inbound: { partner: { verify: acceptingVerifier } } });
    const result = await postel.inbound.partner.verify("", {});
    expect(result.event.type).toBe("custom.accepted");
    expect(result.matchedVerifierIndex).toBe(0);
  });

  it("Custom verifier that throws SignatureInvalid rejects the call", async () => {
    const postel = Postel({ inbound: { partner: { verify: rejectingVerifier } } });
    await expect(postel.inbound.partner.verify("", {})).rejects.toBeInstanceOf(SignatureInvalid);
  });

  it("Custom verifier composes in an array — falls through to the accepting entry at index 1", async () => {
    const postel = Postel({
      inbound: { partner: { verify: [rejectingVerifier, acceptingVerifier] } },
    });
    const result = await postel.inbound.partner.verify("", {});
    expect(result.matchedVerifierIndex).toBe(1);
    expect(result.event.type).toBe("custom.accepted");
  });

  it("Noop accepts an unauthenticated request without checking signature or timestamp", async () => {
    const body = JSON.stringify({ type: "order.created", data: { id: "order_42" } });
    const postel = Postel({ inbound: { trusted: { verify: Noop() } } });
    const result = await postel.inbound.trusted.verify(body, {
      "webhook-id": "msg_1",
      "webhook-timestamp": "1",
      "webhook-signature": "v1,bogus",
    });
    expect(result.event.type).toBe("order.created");
    expect(result.matchedVerifierIndex).toBe(0);
  });

  it("Noop with no signing headers at all still resolves with the parsed event", async () => {
    const body = JSON.stringify({ type: "order.created", data: { id: "order_42" } });
    const postel = Postel({ inbound: { trusted: { verify: Noop() } } });
    const result = await postel.inbound.trusted.verify(body, {});
    expect(result.event.type).toBe("order.created");
  });

  it("Noop still parses the envelope — a non-JSON body is rejected, not silently accepted", async () => {
    const postel = Postel({ inbound: { trusted: { verify: Noop() } } });
    await expect(postel.inbound.trusted.verify("not json", {})).rejects.toBeInstanceOf(
      SignatureInvalid,
    );
  });

  it("Noop still parses the envelope — a body missing `type` keeps the MalformedHeader as cause", async () => {
    const postel = Postel({ inbound: { trusted: { verify: Noop() } } });
    try {
      await postel.inbound.trusted.verify(JSON.stringify({ data: { id: "x" } }), {});
      throw new Error("verify should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SignatureInvalid);
      expect((err as SignatureInvalid).cause).toBeInstanceOf(MalformedHeader);
    }
  });
});
