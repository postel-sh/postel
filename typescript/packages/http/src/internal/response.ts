import type { WebhookOutcome } from "../types.js";

export function outcomeToResponse(outcome: WebhookOutcome): Response {
  return new Response(outcome.body ?? null, {
    status: outcome.status,
    headers: outcome.headers,
  });
}
