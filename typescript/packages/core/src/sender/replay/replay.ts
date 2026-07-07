import type { Clock } from "../../clock.js";
import { EndpointValidation } from "../../errors.js";
import type { ReplayOptions, ReplayResult } from "../../outbound.js";
import type { Page } from "../../pagination.js";
import type { MessageId, Storage } from "../../storage/types.js";
import { newMessageId } from "../internal/id.js";

const DEFAULT_REPLAY_THROUGHPUT = 100;

// An unparseable date is a caller error, not a silent unbounded (or empty)
// time filter — same posture as `messages.list`.
function toValidDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`invalid date: ${String(value)}`);
  }
  return date;
}

export interface ReplayContext {
  readonly storage: Storage;
  readonly clock: Clock;
  readonly defaultThroughput?: number;
}

// Paces re-enqueues to at most `perSecond` per rolling 1s window so a large
// range/predicate replay doesn't flood downstream receivers once workers pick
// the messages up. Uses the injected clock's sleep (a no-op-but-advances under
// FakeClock; a real wait under systemClock).
function makeReplayPacer(perSecond: number, clock: Clock): () => Promise<void> {
  let windowStart = clock.now().getTime();
  let inWindow = 0;
  return async () => {
    inWindow += 1;
    if (inWindow <= perSecond) return;
    const elapsed = clock.now().getTime() - windowStart;
    if (elapsed < 1000) await clock.sleep(1000 - elapsed);
    windowStart = clock.now().getTime();
    inWindow = 1;
  };
}

interface ReplaySource {
  readonly id: MessageId;
  readonly tenantId: string | null;
  readonly type: string;
  readonly data: unknown;
  readonly channels: ReadonlyArray<string> | null;
  readonly version: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
}

// Returns the number of rows actually enqueued (1) or 0 when the message id is
// not found, so the caller never reports a replay that did not happen. Callers
// that already hold the row (range / predicate loops) pass it directly to avoid
// an O(n) re-scan per message; the single-message form passes just the id.
async function rescheduleOne(
  storage: Storage,
  clock: Clock,
  source: ReplaySource | MessageId,
  freshWebhookId: boolean,
  tx: unknown,
): Promise<number> {
  const originalId = typeof source === "string" ? source : source.id;
  if (freshWebhookId) {
    let original = typeof source === "string" ? undefined : source;
    if (original === undefined) {
      for await (const m of storage.rangeQuery({})) {
        if (m.id === originalId) {
          original = m;
          break;
        }
      }
    }
    if (!original) return 0;
    const newId = newMessageId();
    await storage.insertMessage(
      {
        id: newId,
        tenantId: original.tenantId,
        type: original.type,
        data: original.data,
        channels: original.channels,
        idempotencyKey: null,
        version: original.version,
        ttlSeconds: null,
        createdAt: clock.now(),
        expiresAt: original.expiresAt,
        // Tag the fresh row so its attempts reference the original message id.
        replayOf: originalId,
      },
      tx !== undefined ? { tx } : undefined,
    );
    return 1;
  }
  // Reused id: re-deliver the same row; tag it as a replay of itself so its new
  // attempts are distinguishable from the original delivery in the audit trail.
  const rescheduled = await storage.rescheduleMessage(originalId, {
    scheduledFor: clock.now(),
    replayOf: originalId,
    ...(tx !== undefined ? { tx } : {}),
  });
  return rescheduled ? 1 : 0;
}

export async function replayImpl(ctx: ReplayContext, opts: ReplayOptions): Promise<ReplayResult> {
  if (!("freshWebhookId" in opts)) {
    throw new EndpointValidation(
      "ENDPOINT_VALIDATION: replay requires explicit freshWebhookId (true|false) — no implicit default",
    );
  }
  const tx = opts.tx;
  if ("messageId" in opts) {
    const enqueued = await rescheduleOne(
      ctx.storage,
      ctx.clock,
      opts.messageId,
      opts.freshWebhookId,
      tx,
    );
    return { enqueued };
  }
  const throttle =
    "replayThroughput" in opts && opts.replayThroughput !== undefined
      ? opts.replayThroughput
      : (ctx.defaultThroughput ?? DEFAULT_REPLAY_THROUGHPUT);
  const pace = makeReplayPacer(throttle, ctx.clock);
  let count = 0;
  if ("filter" in opts) {
    const predicate = opts.filter;
    for await (const m of ctx.storage.rangeQuery({ predicate })) {
      await pace();
      count += await rescheduleOne(ctx.storage, ctx.clock, m, opts.freshWebhookId, tx);
    }
    return { enqueued: count };
  }
  const filter: {
    endpointId?: string;
    since?: Date;
    until?: Date;
    types?: ReadonlyArray<string>;
  } = {};
  filter.endpointId = opts.endpointId;
  filter.since = toValidDate(opts.since);
  if (opts.until !== undefined) {
    filter.until = toValidDate(opts.until);
  }
  if (opts.types !== undefined) filter.types = opts.types;
  for await (const m of ctx.storage.rangeQuery(filter)) {
    await pace();
    count += await rescheduleOne(ctx.storage, ctx.clock, m, opts.freshWebhookId, tx);
  }
  return { enqueued: count };
}

export async function reconcileImpl(
  ctx: ReplayContext,
  opts: {
    readonly endpointId: string;
    readonly since: Date | string;
    readonly limit?: number;
    readonly cursor?: string;
  },
): Promise<Page<MessageId>> {
  // A non-positive or non-integer limit is a caller error, not a silent
  // default — same guard as the list reads.
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit <= 0)) {
    throw new RangeError(`limit must be a positive integer, received ${String(opts.limit)}`);
  }
  const sinceDate = toValidDate(opts.since);
  return ctx.storage.reconcile({
    endpointId: opts.endpointId,
    since: sinceDate,
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
  });
}
