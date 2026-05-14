import { MalformedHeader } from "../errors.js";
import type { WebhookHeaders } from "../types.js";

export const ID_HEADER = "webhook-id";
export const TIMESTAMP_HEADER = "webhook-timestamp";
export const SIGNATURE_HEADER = "webhook-signature";

export function readHeader(headers: WebhookHeaders, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return undefined;
}

export function requireHeader(headers: WebhookHeaders, name: string): string {
  const value = readHeader(headers, name);
  if (value === undefined || value.length === 0) {
    throw new MalformedHeader(`Missing required header: ${name}`);
  }
  return value;
}
