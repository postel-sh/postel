import {
  dedup,
  jwksHandler,
  verify,
  type DedupOptions,
  type DedupResult,
  type JwksHandlerOptions,
  type SecretOrKeyset,
  type VerifyOptions,
  type VerifyResult,
  type WebhookHeaders,
} from "@postel/edge";

export interface PostelOptions {
  readonly _reserved?: never;
}

export interface PostelInstance {
  verify<TData = unknown>(
    rawBody: ArrayBuffer | Uint8Array | string,
    headers: WebhookHeaders,
    secretOrKeyset: SecretOrKeyset,
    options?: VerifyOptions,
  ): Promise<VerifyResult<TData>>;
  dedup(messageId: string, options: DedupOptions): Promise<DedupResult>;
  jwksHandler(options: JwksHandlerOptions): (request: Request) => Response;
}

export function Postel(_opts?: PostelOptions): PostelInstance {
  return {
    verify,
    dedup,
    jwksHandler,
  };
}
