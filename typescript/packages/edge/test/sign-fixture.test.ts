import { describe, expect, it } from "vitest";

import { signFixture, verify } from "../src/index.js";

const SECRET = "whsec_dGVzdC1maXh0dXJlLXNlY3JldC1mb3ItcG9zdGVs";

describe("Test fixtures for signed payloads", () => {
  it("signFixture returns headers + body that verify(body, headers, secret) accepts", async () => {
    const timestamp = new Date("2026-05-14T11:30:00Z");
    const signed = await signFixture({
      secret: SECRET,
      payload: {
        type: "user.profile.updated",
        timestamp: "2026-05-14T11:29:55Z",
        data: { userId: "u_7" },
      },
      timestamp,
    });

    expect(signed.headers["webhook-id"]).toMatch(/^msg_/u);
    expect(signed.headers["webhook-timestamp"]).toBe(
      Math.floor(timestamp.getTime() / 1000).toString(),
    );
    expect(signed.headers["webhook-signature"]).toMatch(/^v1,[A-Za-z0-9+/=]+$/u);

    const result = await verify(signed.body, signed.headers, SECRET, { now: () => timestamp });
    expect(result.event.type).toBe("user.profile.updated");
    expect(result.matchedSecretIndex).toBe(0);
  });

  it("a caller-supplied messageId flows through to the headers", async () => {
    const signed = await signFixture({
      secret: SECRET,
      messageId: "msg_explicit_42",
      timestamp: new Date("2026-05-14T11:30:00Z"),
      payload: { type: "x", timestamp: "2026-05-14T11:29:55Z", data: {} },
    });
    expect(signed.headers["webhook-id"]).toBe("msg_explicit_42");
  });
});
