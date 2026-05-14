import type { SecretOrKeyset, VerifyOptions, VerifyResult, WebhookHeaders } from "./types.js";

export function verify<TData = unknown>(
  _rawBody: ArrayBuffer | Uint8Array | string,
  _headers: WebhookHeaders,
  _secretOrKeyset: SecretOrKeyset,
  _options?: VerifyOptions,
): Promise<VerifyResult<TData>> {
  throw new Error("@postel/edge: verify is not implemented in the v0.1.0 skeleton");
}
