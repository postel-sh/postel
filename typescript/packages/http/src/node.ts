import type { WebhookOutcome } from "./types.js";

export interface NodeResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: string | Uint8Array): void;
}

export function writeOutcomeToNodeRes(res: NodeResponseLike, outcome: WebhookOutcome): void {
  res.statusCode = outcome.status;
  for (const [name, value] of Object.entries(outcome.headers)) {
    res.setHeader(name, value);
  }
  if (outcome.body === undefined) {
    res.end();
  } else {
    res.end(outcome.body);
  }
}

export function headersFromNode(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(headers)) {
    const value = headers[key];
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? (value[0] ?? "") : value;
  }
  return out;
}
