import { MalformedHeader } from "../errors.js";
import type { WebhookEvent } from "../types.js";

export function bodyToText(rawBody: ArrayBuffer | Uint8Array | string): string {
  if (typeof rawBody === "string") return rawBody;
  if (rawBody instanceof Uint8Array)
    return new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(rawBody));
}

export function parseEvent<TData>(bodyText: string): WebhookEvent<TData> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch (cause) {
    throw new MalformedHeader("webhook body is not valid JSON", { cause });
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new MalformedHeader("webhook body must be a JSON object");
  }
  const obj = parsed as { type?: unknown };
  if (typeof obj.type !== "string") {
    throw new MalformedHeader("webhook body missing string `type` field");
  }
  return obj as unknown as WebhookEvent<TData>;
}
