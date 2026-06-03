import {
  MalformedHeader,
  NotImplementedError,
  PostelError,
  RawBytesMismatchDetected,
  SignatureInvalid,
  TimestampTooOld,
  UnknownKeyId,
} from "@postel/core";
import { describe, expect, it } from "vitest";

import { errorBody, statusForError } from "../src/index.js";

describe("Framework adapters gate verification and map protocol errors to HTTP status", () => {
  it("maps each receiver PostelError code to the canonical status", () => {
    expect(statusForError(new SignatureInvalid("bad signature"))).toBe(400);
    expect(statusForError(new TimestampTooOld("stale"))).toBe(400);
    expect(statusForError(new MalformedHeader("missing header"))).toBe(400);
    expect(statusForError(new RawBytesMismatchDetected("mismatch"))).toBe(400);
    expect(statusForError(new UnknownKeyId("unknown kid"))).toBe(401);
  });

  it("renders a stable JSON error body carrying the stable code", () => {
    expect(JSON.parse(errorBody(new SignatureInvalid("nope")))).toEqual({
      error: { code: "SIGNATURE_INVALID", message: "nope" },
    });
  });

  it("treats NotImplementedError as outside the PostelError hierarchy so it bubbles as 5xx", () => {
    const err = new NotImplementedError("outbound.send");
    expect(err instanceof PostelError).toBe(false);
    expect(err instanceof Error).toBe(true);
  });
});
