import { describe, expect, it } from "vitest";

import {
  EndpointDisabled,
  EndpointNotFound,
  EndpointValidation,
  IdempotencyKeyConflict,
  MalformedHeader,
  MigrationRequired,
  NotImplementedError,
  PostelError,
  type PostelErrorCode,
  RawBytesMismatchDetected,
  SignatureInvalid,
  SsrfBlocked,
  TimestampTooOld,
  UnknownKeyId,
} from "../src/index.js";

const CANONICAL_TABLE: ReadonlyArray<{
  readonly cls: new (msg: string) => PostelError;
  readonly code: PostelErrorCode;
  readonly name: string;
}> = [
  { cls: SignatureInvalid, code: "SIGNATURE_INVALID", name: "SignatureInvalid" },
  { cls: TimestampTooOld, code: "TIMESTAMP_TOO_OLD", name: "TimestampTooOld" },
  { cls: MalformedHeader, code: "MALFORMED_HEADER", name: "MalformedHeader" },
  { cls: UnknownKeyId, code: "UNKNOWN_KEY_ID", name: "UnknownKeyId" },
  {
    cls: RawBytesMismatchDetected,
    code: "RAW_BYTES_MISMATCH_DETECTED",
    name: "RawBytesMismatchDetected",
  },
  { cls: EndpointDisabled, code: "ENDPOINT_DISABLED", name: "EndpointDisabled" },
  { cls: EndpointNotFound, code: "ENDPOINT_NOT_FOUND", name: "EndpointNotFound" },
  {
    cls: IdempotencyKeyConflict,
    code: "IDEMPOTENCY_KEY_CONFLICT",
    name: "IdempotencyKeyConflict",
  },
  { cls: MigrationRequired, code: "MIGRATION_REQUIRED", name: "MigrationRequired" },
  { cls: EndpointValidation, code: "ENDPOINT_VALIDATION", name: "EndpointValidation" },
  { cls: SsrfBlocked, code: "SSRF_BLOCKED", name: "SsrfBlocked" },
];

describe("Structured error classes", () => {
  it("instanceof discrimination: every canonical class is identifiable via instanceof", () => {
    for (const { cls } of CANONICAL_TABLE) {
      const err = new cls("boom");
      expect(err).toBeInstanceOf(cls);
      expect(err).toBeInstanceOf(PostelError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("code property discrimination: every class exposes its stable SCREAMING_SNAKE code", () => {
    for (const { cls, code } of CANONICAL_TABLE) {
      const err = new cls("boom");
      expect(err.code).toBe(code);
    }
  });

  it("Cross-port code parity: codes are stable strings consumers can match in JSON payloads", () => {
    for (const { cls, code } of CANONICAL_TABLE) {
      const err = new cls("boom");
      const json = JSON.parse(JSON.stringify({ code: err.code, message: err.message }));
      expect(json.code).toBe(code);
    }
  });

  it("PascalCase class names match the canonical table", () => {
    for (const { cls, name } of CANONICAL_TABLE) {
      expect(cls.name).toBe(name);
      const err = new cls("boom");
      expect(err.name).toBe(name);
    }
  });

  it("Implementation-state errors are not PostelError: NotImplementedError is outside the hierarchy", () => {
    const err = new NotImplementedError("postel.outbound.send");
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PostelError);
    expect(err.code).toBe("NOT_IMPLEMENTED");
  });
});

describe("No string matching on errors", () => {
  it("every canonical class is discriminated by class identity, not message string", () => {
    for (const { cls, code } of CANONICAL_TABLE) {
      const err = new cls(
        "any message at all — including a code-shaped one like SIGNATURE_INVALID",
      );
      expect(err instanceof cls).toBe(true);
      expect(err.code).toBe(code);
    }
  });

  it("two classes with the same message remain instanceof-distinguishable", () => {
    const a = new SignatureInvalid("X");
    const b = new TimestampTooOld("X");
    expect(a.message).toBe(b.message);
    expect(a).toBeInstanceOf(SignatureInvalid);
    expect(a).not.toBeInstanceOf(TimestampTooOld);
    expect(b).toBeInstanceOf(TimestampTooOld);
    expect(b).not.toBeInstanceOf(SignatureInvalid);
    expect(a.code).not.toBe(b.code);
  });
});
