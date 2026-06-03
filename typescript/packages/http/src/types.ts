import type {
  ComposedVerifyResult,
  DedupResult,
  PostelError,
  WebhookEvent,
  WebhookHeaders,
} from "@postel/core";

export type RawBody = ArrayBuffer | Uint8Array | string;

export interface NormalizedRequest {
  readonly rawBody: RawBody;
  readonly headers: WebhookHeaders;
  readonly method: string;
}

export interface GateSource {
  verify<TData = unknown>(
    rawBody: RawBody,
    headers: WebhookHeaders,
  ): Promise<ComposedVerifyResult<TData>>;
  dedup?(messageId: string, options?: { readonly ttl?: number | string }): Promise<DedupResult>;
}

export interface HandlerResponseInit {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
}

// biome-ignore lint/suspicious/noConfusingVoidType: onVerified may return nothing (void) or a HandlerResponseInit
export type HandlerResponse = HandlerResponseInit | void;

export interface WebhookContext<TData = unknown> {
  readonly result: ComposedVerifyResult<TData>;
  readonly event: WebhookEvent<TData>;
  readonly messageId: string | undefined;
  readonly headers: WebhookHeaders;
  readonly rawBody: RawBody;
}

export interface DedupAckOptions {
  readonly ttl?: number | string;
  readonly duplicateStatus?: number;
}

export interface WebhookHandlerOptions<TData = unknown> {
  readonly onVerified?: (ctx: WebhookContext<TData>) => HandlerResponse | Promise<HandlerResponse>;
  readonly successStatus?: number;
  readonly dedup?: DedupAckOptions;
}

export type WebhookOutcome<TData = unknown> =
  | {
      readonly kind: "verified";
      readonly status: number;
      readonly headers: Record<string, string>;
      readonly body: string | Uint8Array | undefined;
      readonly context: WebhookContext<TData>;
    }
  | {
      readonly kind: "duplicate";
      readonly status: number;
      readonly headers: Record<string, string>;
      readonly body: undefined;
      readonly messageId: string;
    }
  | {
      readonly kind: "error";
      readonly status: number;
      readonly headers: Record<string, string>;
      readonly body: string;
      readonly error: PostelError;
    };
