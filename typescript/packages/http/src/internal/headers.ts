import type { WebhookHeaders } from "@postel/core";

const ID_HEADER = "webhook-id";

export function readMessageId(headers: WebhookHeaders): string | undefined {
  const direct = headers[ID_HEADER];
  if (direct !== undefined) return direct;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === ID_HEADER) return headers[key];
  }
  return undefined;
}

export function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}
