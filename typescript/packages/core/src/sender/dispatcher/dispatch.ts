import type { Clock } from "../../clock.js";
import type {
  EndpointWithSecrets,
  NewAttempt,
  ReservedMessage,
  Storage,
} from "../../storage/types.js";
import { newAttemptId } from "../internal/id.js";

export interface DispatchContext {
  readonly storage: Storage;
  readonly clock: Clock;
}

export interface DispatchOutcome {
  readonly status: NewAttempt["status"];
  readonly responseCode: number | null;
  readonly latencyMs: number;
  readonly error: string | null;
}

export type DispatchOne = (
  ctx: DispatchContext,
  msg: ReservedMessage,
  endpoint: EndpointWithSecrets,
) => Promise<DispatchOutcome>;

export const stubDispatchOne: DispatchOne = async (_ctx, _msg, _endpoint) => ({
  status: "success",
  responseCode: 200,
  latencyMs: 0,
  error: null,
});

export async function dispatchMessage(
  ctx: DispatchContext,
  msg: ReservedMessage,
  dispatchOne: DispatchOne,
): Promise<void> {
  const endpoints = await ctx.storage.loadEndpointsForMessage(msg.id);
  if (endpoints.length === 0) {
    await ctx.storage.markMessageFinal(msg.id, "dispatched");
    return;
  }
  if (msg.expiresAt !== null && msg.expiresAt < ctx.clock.now()) {
    await ctx.storage.recordAttempt({
      id: newAttemptId(),
      messageId: msg.id,
      endpointId: endpoints[0]?.endpoint.id ?? "",
      tenantId: msg.tenantId,
      attemptNumber: msg.attemptNumber,
      status: "expired",
      scheduledFor: msg.scheduledFor,
      startedAt: ctx.clock.now(),
      completedAt: ctx.clock.now(),
      responseCode: null,
      responseHeaders: null,
      responseBody: null,
      latencyMs: 0,
      error: "TTL_EXCEEDED",
      replayOf: msg.replayOf,
    });
    await ctx.storage.markMessageFinal(msg.id, "expired");
    return;
  }
  let anyRetryable = false;
  for (const endpoint of endpoints) {
    const startedAt = ctx.clock.now();
    const outcome = await dispatchOne(ctx, msg, endpoint);
    const completedAt = ctx.clock.now();
    if (outcome.status === "failed") {
      anyRetryable = true;
    }
    if (outcome.status === "failed-permanent") {
      // permanently failed; no further attempts for this endpoint, but message proceeds to final.
    }
    await ctx.storage.recordAttempt({
      id: newAttemptId(),
      messageId: msg.id,
      endpointId: endpoint.endpoint.id,
      tenantId: msg.tenantId,
      attemptNumber: msg.attemptNumber,
      status: outcome.status,
      scheduledFor: msg.scheduledFor,
      startedAt,
      completedAt,
      responseCode: outcome.responseCode,
      responseHeaders: null,
      responseBody: null,
      latencyMs: outcome.latencyMs,
      error: outcome.error,
      replayOf: msg.replayOf,
    });
  }
  if (!anyRetryable) {
    await ctx.storage.markMessageFinal(msg.id, "dispatched");
  }
}
