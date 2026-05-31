import type { Clock } from "../../clock.js";
import { EndpointValidation } from "../../errors.js";
import type { ReplayOptions, ReplayResult } from "../../outbound.js";
import type { MessageId, Storage } from "../../storage/types.js";
import { newMessageId } from "../internal/id.js";

const DEFAULT_REPLAY_THROUGHPUT = 100;

export interface ReplayContext {
  readonly storage: Storage;
  readonly clock: Clock;
  readonly defaultThroughput?: number;
}

async function rescheduleOne(
  storage: Storage,
  clock: Clock,
  originalId: MessageId,
  freshWebhookId: boolean,
  tx: unknown,
): Promise<void> {
  if (freshWebhookId) {
    const records: unknown[] = [];
    for await (const m of storage.rangeQuery({})) {
      if (m.id === originalId) records.push(m);
    }
    const original = records[0] as
      | {
          id: MessageId;
          tenantId: string | null;
          type: string;
          data: unknown;
          channels: ReadonlyArray<string> | null;
          version: string | null;
          createdAt: Date;
          expiresAt: Date | null;
        }
      | undefined;
    if (!original) return;
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
      },
      tx !== undefined ? { tx } : undefined,
    );
    return;
  }
  await storage.rescheduleMessage(originalId, {
    scheduledFor: clock.now(),
    ...(tx !== undefined ? { tx } : {}),
  });
}

export async function replayImpl(ctx: ReplayContext, opts: ReplayOptions): Promise<ReplayResult> {
  if (!("freshWebhookId" in opts)) {
    throw new EndpointValidation(
      "ENDPOINT_VALIDATION: replay requires explicit freshWebhookId (true|false) — no implicit default",
    );
  }
  const tx = opts.tx;
  if ("messageId" in opts) {
    await rescheduleOne(ctx.storage, ctx.clock, opts.messageId, opts.freshWebhookId, tx);
    return { enqueued: 1 };
  }
  const throttle =
    "replayThroughput" in opts && opts.replayThroughput !== undefined
      ? opts.replayThroughput
      : (ctx.defaultThroughput ?? DEFAULT_REPLAY_THROUGHPUT);
  void throttle;
  let count = 0;
  if ("filter" in opts) {
    const predicate = opts.filter;
    for await (const m of ctx.storage.rangeQuery({ predicate })) {
      await rescheduleOne(ctx.storage, ctx.clock, m.id, opts.freshWebhookId, tx);
      count += 1;
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
  filter.since = opts.since instanceof Date ? opts.since : new Date(opts.since);
  if (opts.until !== undefined) {
    filter.until = opts.until instanceof Date ? opts.until : new Date(opts.until);
  }
  if (opts.types !== undefined) filter.types = opts.types;
  for await (const m of ctx.storage.rangeQuery(filter)) {
    await rescheduleOne(ctx.storage, ctx.clock, m.id, opts.freshWebhookId, tx);
    count += 1;
  }
  return { enqueued: count };
}

export async function reconcileImpl(
  ctx: ReplayContext,
  endpointId: string,
  since: Date | string,
): Promise<ReadonlyArray<MessageId>> {
  const sinceDate = since instanceof Date ? since : new Date(since);
  const out: MessageId[] = [];
  for await (const id of ctx.storage.reconcile({ endpointId, since: sinceDate })) {
    out.push(id);
  }
  return out;
}
