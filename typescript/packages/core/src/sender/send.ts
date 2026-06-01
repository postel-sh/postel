import type { Clock } from "../clock.js";
import type { MessageId, NewMessage, Storage } from "../storage/types.js";
import { durationToMs } from "./internal/duration.js";
import { newMessageId } from "./internal/id.js";

export interface SendInput {
  readonly type: string;
  readonly data?: unknown;
  readonly channels?: ReadonlyArray<string>;
  readonly idempotencyKey?: string;
  readonly version?: string;
  readonly timestamp?: string | Date;
  readonly ttl?: number | string;
  readonly tenantId?: string;
}

export interface SendContext {
  readonly storage: Storage;
  readonly clock: Clock;
  readonly defaultTenantId?: string | null;
}

export async function sendImpl(
  ctx: SendContext,
  event: SendInput,
  opts?: { readonly tx?: unknown },
): Promise<MessageId> {
  const createdAt = ctx.clock.now();
  const tenantId = event.tenantId ?? ctx.defaultTenantId ?? null;
  let ttlSeconds: number | null = null;
  let expiresAt: Date | null = null;
  if (event.ttl !== undefined) {
    // Numeric TTL is seconds (consistent with ttlToSeconds and the seconds-
    // granularity messages.ttl_seconds column); string TTL is a duration.
    const ms = typeof event.ttl === "number" ? event.ttl * 1000 : durationToMs(event.ttl);
    ttlSeconds = Math.max(0, Math.floor(ms / 1000));
    expiresAt = new Date(createdAt.getTime() + ms);
  }
  const id = newMessageId();
  const row: NewMessage = {
    id,
    tenantId,
    type: event.type,
    data: event.data ?? null,
    channels: event.channels ?? null,
    idempotencyKey: event.idempotencyKey ?? null,
    version: event.version ?? null,
    ttlSeconds,
    createdAt,
    expiresAt,
  };
  if (event.idempotencyKey !== undefined) {
    const res = await ctx.storage.insertOrReuseByIdempotencyKey(row, opts);
    return res.id;
  }
  return ctx.storage.insertMessage(row, opts);
}
