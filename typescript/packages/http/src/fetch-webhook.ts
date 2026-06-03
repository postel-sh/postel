import { handleInbound } from "./handle-inbound.js";
import { headersToRecord } from "./internal/headers.js";
import { outcomeToResponse } from "./internal/response.js";
import type { GateSource, WebhookHandlerOptions } from "./types.js";

export function fetchWebhook<TData = unknown>(
  source: GateSource,
  opts?: WebhookHandlerOptions<TData>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const rawBody = new Uint8Array(await req.arrayBuffer());
    const headers = headersToRecord(req.headers);
    const outcome = await handleInbound<TData>(
      source,
      { rawBody, headers, method: req.method },
      opts,
    );
    return outcomeToResponse(outcome);
  };
}
