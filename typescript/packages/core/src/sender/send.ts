import type { Clock } from "../clock.js";
import { EventValidation } from "../errors.js";
import type { OutboundEventRegistry } from "../outbound.js";
import type { SendResult } from "../outbound.js";
import type { NewMessage, Storage } from "../storage/types.js";
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
  readonly events?: OutboundEventRegistry;
}

export async function sendImpl(
  ctx: SendContext,
  event: SendInput,
  opts?: { readonly tx?: unknown },
): Promise<SendResult> {
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
  let data = event.data ?? null;
  const schema =
    ctx.events && Object.hasOwn(ctx.events, event.type) ? ctx.events[event.type] : undefined;
  if (schema) {
    const out = await schema["~standard"].validate(event.data);
    if (out.issues) throw new EventValidation(out.issues);
    data = out.value ?? null;
  }
  const id = newMessageId();
  const row: NewMessage = {
    id,
    tenantId,
    type: event.type,
    data,
    channels: event.channels ?? null,
    idempotencyKey: event.idempotencyKey ?? null,
    version: event.version ?? null,
    ttlSeconds,
    createdAt,
    expiresAt,
  };
  if (event.idempotencyKey !== undefined) {
    const res = await ctx.storage.insertOrReuseByIdempotencyKey(row, opts);
    return { id: res.id, reused: res.reused };
  }
  return { id: await ctx.storage.insertMessage(row, opts), reused: false };
}
