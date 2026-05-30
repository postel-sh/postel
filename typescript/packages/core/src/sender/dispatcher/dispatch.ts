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
  readonly retryAfterSeconds?: number;
}

const TERMINAL_PER_ENDPOINT: ReadonlySet<NewAttempt["status"]> = new Set([
  "success",
  "failed-permanent",
  "dead-letter",
  "expired",
]);

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
  const priorAttempts = await ctx.storage.attempts.latestForMessage(msg.id);
  const latestByEndpoint = new Map<string, NewAttempt["status"]>();
  for (const attempt of priorAttempts) {
    latestByEndpoint.set(attempt.endpointId, attempt.status);
  }

  let anyRetryable = false;
  for (const endpoint of endpoints) {
    const prior = latestByEndpoint.get(endpoint.endpoint.id);
    if (prior !== undefined && TERMINAL_PER_ENDPOINT.has(prior)) {
      // This endpoint already reached a terminal outcome for this message on an
      // earlier reservation; do not re-deliver while a sibling endpoint retries.
      continue;
    }
    if (endpoint.endpoint.state === "disabled") {
      await ctx.storage.recordAttempt({
        id: newAttemptId(),
        messageId: msg.id,
        endpointId: endpoint.endpoint.id,
        tenantId: msg.tenantId,
        attemptNumber: msg.attemptNumber,
        status: "skipped",
        scheduledFor: msg.scheduledFor,
        startedAt: ctx.clock.now(),
        completedAt: ctx.clock.now(),
        responseCode: null,
        responseHeaders: null,
        responseBody: null,
        latencyMs: 0,
        error: "ENDPOINT_DISABLED",
        replayOf: msg.replayOf,
      });
      continue;
    }
    const startedAt = ctx.clock.now();
    const outcome = await dispatchOne(ctx, msg, endpoint);
    const completedAt = ctx.clock.now();
    if (outcome.status === "failed") {
      anyRetryable = true;
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
