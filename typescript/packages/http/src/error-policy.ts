import type { PostelError, PostelErrorCode } from "@postel/core";

const STATUS_BY_CODE: Record<PostelErrorCode, number> = {
  SIGNATURE_INVALID: 400,
  TIMESTAMP_TOO_OLD: 400,
  MALFORMED_HEADER: 400,
  RAW_BYTES_MISMATCH_DETECTED: 400,
  UNKNOWN_KEY_ID: 401,
  ENDPOINT_DISABLED: 400,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  MIGRATION_REQUIRED: 500,
  ENDPOINT_VALIDATION: 422,
  SSRF_BLOCKED: 400,
};

export function statusForError(err: PostelError): number {
  return STATUS_BY_CODE[err.code];
}

export function errorBody(err: PostelError): string {
  return JSON.stringify({ error: { code: err.code, message: err.message } });
}
