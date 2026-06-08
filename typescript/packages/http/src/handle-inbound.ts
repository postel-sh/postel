import { PostelError } from "@postel/core";
import type { ComposedVerifyResult } from "@postel/core";

import { errorBody, statusForError } from "./error-policy.js";
import { readMessageId } from "./internal/headers.js";
import type {
  GateSource,
  HandlerResponseInit,
  NormalizedRequest,
  WebhookContext,
  WebhookHandlerOptions,
  WebhookOutcome,
} from "./types.js";

const JSON_CONTENT_TYPE = "application/json";

export async function handleInbound<TData = unknown>(
  source: GateSource<TData>,
  req: NormalizedRequest,
  opts?: WebhookHandlerOptions<TData>,
): Promise<WebhookOutcome<TData>> {
  let result: ComposedVerifyResult<TData>;
  try {
    result = await source.verify(req.rawBody, req.headers);
  } catch (err) {
    if (err instanceof PostelError) {
      return {
        kind: "error",
        status: statusForError(err),
        headers: { "content-type": JSON_CONTENT_TYPE },
        body: errorBody(err),
        error: err,
      };
    }
    throw err;
  }

  const messageId = readMessageId(req.headers);

  if (opts?.dedup && source.dedup && messageId !== undefined) {
    const dedupResult = await source.dedup(
      messageId,
      opts.dedup.ttl !== undefined ? { ttl: opts.dedup.ttl } : undefined,
    );
    if (dedupResult.duplicate) {
      return {
        kind: "duplicate",
        status: opts.dedup.duplicateStatus ?? 200,
        headers: { "x-postel-dedup-result": "duplicate" },
        body: undefined,
        messageId,
      };
    }
  }

  const context: WebhookContext<TData> = {
    result,
    event: result.event,
    messageId,
    headers: req.headers,
    rawBody: req.rawBody,
  };

  const handled = await opts?.onVerified?.(context);
  const custom: HandlerResponseInit | undefined =
    typeof handled === "object" && handled !== null ? handled : undefined;

  return {
    kind: "verified",
    status: custom?.status ?? opts?.successStatus ?? 204,
    headers: custom?.headers ? { ...custom.headers } : {},
    body: custom?.body,
    context,
  };
}
