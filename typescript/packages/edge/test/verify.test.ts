import { describe, expect, it } from "vitest";

import {
  MalformedHeader,
  SignatureInvalid,
  TimestampTooOld,
  signFixture,
  verify,
} from "../src/index.js";

const TEST_SECRET_A = "whsec_ZGVtby1zZWNyZXQtYS1mb3ItcG9zdGVsLXRlc3Q=";
const TEST_SECRET_B = "whsec_ZGVtby1zZWNyZXQtYi1mb3ItcG9zdGVsLXRlc3Q=";

const PAYLOAD = {
  type: "order.created",
  timestamp: "2026-05-14T10:00:00Z",
  data: { id: "order_42", amount_cents: 1999 },
} as const;

const FIXED_NOW = new Date("2026-05-14T10:00:30Z");

describe("Verify returns parsed event or structured error", () => {
  describe("Compliant headers, signatures, payload structure, and prefixes by default", () => {
    it("Successful verify returns the parsed Standard Webhooks event", async () => {
      const { body, headers } = await signFixture({
        secret: TEST_SECRET_A,
        payload: PAYLOAD,
        timestamp: FIXED_NOW,
      });

      const result = await verify(body, headers, TEST_SECRET_A, { now: () => FIXED_NOW });

      expect(result.event.type).toBe("order.created");
      expect(result.event.timestamp).toBe("2026-05-14T10:00:00Z");
      expect(result.event.data).toEqual({ id: "order_42", amount_cents: 1999 });
      expect(result.matchedSecretIndex).toBe(0);
    });

    it("rejects a webhook-signature header that is not <version>,<base64>", async () => {
      const { body, headers } = await signFixture({
        secret: TEST_SECRET_A,
        payload: PAYLOAD,
        timestamp: FIXED_NOW,
      });
      const malformedHeaders = { ...headers, "webhook-signature": "garbage-no-comma" };

      await expect(
        verify(body, malformedHeaders, TEST_SECRET_A, { now: () => FIXED_NOW }),
      ).rejects.toBeInstanceOf(MalformedHeader);
    });

    it("rejects an empty webhook-signature header with MALFORMED_HEADER", async () => {
      const { body, headers } = await signFixture({
        secret: TEST_SECRET_A,
        payload: PAYLOAD,
        timestamp: FIXED_NOW,
      });
      const malformedHeaders = { ...headers, "webhook-signature": "" };

      await expect(
        verify(body, malformedHeaders, TEST_SECRET_A, { now: () => FIXED_NOW }),
      ).rejects.toMatchObject({ code: "MALFORMED_HEADER" });
    });

    it("rejects when webhook-id is missing", async () => {
      const { body, headers } = await signFixture({
        secret: TEST_SECRET_A,
        payload: PAYLOAD,
        timestamp: FIXED_NOW,
      });
      const { "webhook-id": _omit, ...rest } = headers;

      await expect(
        verify(body, rest, TEST_SECRET_A, { now: () => FIXED_NOW }),
      ).rejects.toMatchObject({ code: "MALFORMED_HEADER" });
    });

    it("Bad signature throws SignatureInvalid and names the failing step", async () => {
      const { body, headers } = await signFixture({
        secret: TEST_SECRET_A,
        payload: PAYLOAD,
        timestamp: FIXED_NOW,
      });
      const tampered = body.replace("order_42", "order_43");

      await expect(
        verify(tampered, headers, TEST_SECRET_A, { now: () => FIXED_NOW }),
      ).rejects.toBeInstanceOf(SignatureInvalid);
    });

    it("error codes match the SCREAMING_SNAKE_CASE vocabulary", async () => {
      const { body, headers } = await signFixture({
        secret: TEST_SECRET_A,
        payload: PAYLOAD,
        timestamp: FIXED_NOW,
      });
      try {
        await verify(body.replace("order_42", "order_43"), headers, TEST_SECRET_A, {
          now: () => FIXED_NOW,
        });
        throw new Error("verify should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SignatureInvalid);
        expect((err as SignatureInvalid).code).toBe("SIGNATURE_INVALID");
      }
    });
  });
});

describe("Multi-secret window", () => {
  it("verify accepts an array of secrets and tries each in order", async () => {
    const signed = await signFixture({
      secret: TEST_SECRET_B,
      payload: PAYLOAD,
      timestamp: FIXED_NOW,
    });

    const result = await verify(signed.body, signed.headers, [TEST_SECRET_A, TEST_SECRET_B], {
      now: () => FIXED_NOW,
    });

    expect(result.matchedSecretIndex).toBe(1);
  });

  it("first secret takes priority when both could match (Multi-secret window)", async () => {
    const signed = await signFixture({
      secret: TEST_SECRET_A,
      payload: PAYLOAD,
      timestamp: FIXED_NOW,
    });
    const result = await verify(signed.body, signed.headers, [TEST_SECRET_A, TEST_SECRET_B], {
      now: () => FIXED_NOW,
    });
    expect(result.matchedSecretIndex).toBe(0);
  });

  it("rejects when none of the secrets match", async () => {
    const signed = await signFixture({
      secret: TEST_SECRET_A,
      payload: PAYLOAD,
      timestamp: FIXED_NOW,
    });
    await expect(
      verify(signed.body, signed.headers, [TEST_SECRET_B], { now: () => FIXED_NOW }),
    ).rejects.toBeInstanceOf(SignatureInvalid);
  });
});

describe("Timestamp window enforcement", () => {
  it("rejects a 10-minute-old timestamp with the default 5-minute window", async () => {
    const signed = await signFixture({
      secret: TEST_SECRET_A,
      payload: PAYLOAD,
      timestamp: new Date("2026-05-14T10:00:00Z"),
    });
    await expect(
      verify(signed.body, signed.headers, TEST_SECRET_A, {
        now: () => new Date("2026-05-14T10:10:00Z"),
      }),
    ).rejects.toBeInstanceOf(TimestampTooOld);
  });

  it("rejects a future timestamp that exceeds the tolerance window", async () => {
    const signed = await signFixture({
      secret: TEST_SECRET_A,
      payload: PAYLOAD,
      timestamp: new Date("2026-05-14T10:10:00Z"),
    });
    await expect(
      verify(signed.body, signed.headers, TEST_SECRET_A, {
        now: () => new Date("2026-05-14T10:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(TimestampTooOld);
  });

  it("accepts a 4-minute-old timestamp within the default window", async () => {
    const signed = await signFixture({
      secret: TEST_SECRET_A,
      payload: PAYLOAD,
      timestamp: new Date("2026-05-14T10:00:00Z"),
    });
    const result = await verify(signed.body, signed.headers, TEST_SECRET_A, {
      now: () => new Date("2026-05-14T10:04:00Z"),
    });
    expect(result.matchedSecretIndex).toBe(0);
  });

  it("honors a custom toleranceSeconds", async () => {
    const signed = await signFixture({
      secret: TEST_SECRET_A,
      payload: PAYLOAD,
      timestamp: new Date("2026-05-14T10:00:00Z"),
    });
    await expect(
      verify(signed.body, signed.headers, TEST_SECRET_A, {
        toleranceSeconds: 30,
        now: () => new Date("2026-05-14T10:01:00Z"),
      }),
    ).rejects.toBeInstanceOf(TimestampTooOld);
  });
});

describe("Replay-attack window enforcement", () => {
  it("a 10-minute-late replayed signed request is rejected by the timestamp window", async () => {
    const signed = await signFixture({
      secret: TEST_SECRET_A,
      payload: PAYLOAD,
      timestamp: new Date("2026-05-14T10:00:00Z"),
    });

    await expect(
      verify(signed.body, signed.headers, TEST_SECRET_A, {
        now: () => new Date("2026-05-14T10:10:01Z"),
      }),
    ).rejects.toBeInstanceOf(TimestampTooOld);
  });
});
