import { bodyToText, parseEvent } from "../internal/event.js";
import { createKeyset } from "../keyset.js";
import type { KeysetOptions, VerifyOptions, VerifyResult, WebhookHeaders } from "../types.js";
import { verify } from "../verify.js";

export interface Verifier {
  verify(
    rawBody: ArrayBuffer | Uint8Array | string,
    headers: WebhookHeaders,
    options?: VerifyOptions,
  ): Promise<VerifyResult>;
}

export function Secret(value: string): Verifier {
  return {
    verify: (rawBody, headers, options) => verify(rawBody, headers, value, options),
  };
}

export function PublicKey(value: string): Verifier {
  return {
    verify: (rawBody, headers, options) => verify(rawBody, headers, value, options),
  };
}

export function Keyset(opts: KeysetOptions): Verifier {
  const keyset = createKeyset(opts);
  return {
    verify: (rawBody, headers, options) => verify(rawBody, headers, keyset, options),
  };
}

export function Noop(): Verifier {
  return {
    verify: async (rawBody) => ({
      event: parseEvent(bodyToText(rawBody)),
      matchedSecretIndex: 0,
    }),
  };
}
