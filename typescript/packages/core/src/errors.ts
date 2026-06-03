export type PostelErrorCode =
  | "SIGNATURE_INVALID"
  | "TIMESTAMP_TOO_OLD"
  | "MALFORMED_HEADER"
  | "UNKNOWN_KEY_ID"
  | "RAW_BYTES_MISMATCH_DETECTED"
  | "ENDPOINT_DISABLED"
  | "ENDPOINT_NOT_FOUND"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "MIGRATION_REQUIRED"
  | "ENDPOINT_VALIDATION"
  | "SSRF_BLOCKED";

export abstract class PostelError extends Error {
  abstract readonly code: PostelErrorCode;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class SignatureInvalid extends PostelError {
  readonly code = "SIGNATURE_INVALID" as const;
}

export class TimestampTooOld extends PostelError {
  readonly code = "TIMESTAMP_TOO_OLD" as const;
}

export class MalformedHeader extends PostelError {
  readonly code = "MALFORMED_HEADER" as const;
}

export class UnknownKeyId extends PostelError {
  readonly code = "UNKNOWN_KEY_ID" as const;
}

export class RawBytesMismatchDetected extends PostelError {
  readonly code = "RAW_BYTES_MISMATCH_DETECTED" as const;
}

export class EndpointDisabled extends PostelError {
  readonly code = "ENDPOINT_DISABLED" as const;
}

export class EndpointNotFound extends PostelError {
  readonly code = "ENDPOINT_NOT_FOUND" as const;
}

export class IdempotencyKeyConflict extends PostelError {
  readonly code = "IDEMPOTENCY_KEY_CONFLICT" as const;
}

export class MigrationRequired extends PostelError {
  readonly code = "MIGRATION_REQUIRED" as const;
}

export class EndpointValidation extends PostelError {
  readonly code = "ENDPOINT_VALIDATION" as const;
}

export class SsrfBlocked extends PostelError {
  readonly code = "SSRF_BLOCKED" as const;
}

export class NotImplementedError extends Error {
  override readonly name = "NotImplementedError" as const;
  readonly code = "NOT_IMPLEMENTED" as const;
  constructor(symbol: string) {
    super(
      `${symbol} is not implemented in @postel/core v0.x. The relevant types are present, but invoking this feature throws until it ships. See VISION.md and the project roadmap for delivery details.`,
    );
  }
}
