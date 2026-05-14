export type PostelErrorCode =
  | "SIGNATURE_INVALID"
  | "TIMESTAMP_TOO_OLD"
  | "MALFORMED_HEADER"
  | "UNKNOWN_KEY_ID"
  | "RAW_BYTES_MISMATCH_DETECTED";

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
