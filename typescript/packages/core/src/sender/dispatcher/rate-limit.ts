import type { Clock } from "../../clock.js";
import type { Storage, TenantId } from "../../storage/types.js";
import { decodeRateLimitStrategy } from "../../strategies/rate-limit.js";
import type { DispatchContext, DispatchOne, DispatchOutcome } from "./dispatch.js";

export interface RateLimitDispatcherDeps {
  readonly storage: Storage;
  readonly clock: Clock;
}

interface Window {
  windowStart: number;
  count: number;
}

// Rolling 1s window per tenant, mirroring the replay pacer's pacing semantics
// (see sender/replay/replay.ts) but non-blocking: instead of sleeping the
// caller, an over-cap attempt is reported to the caller as denied so it can
// reschedule the message and move on to other tenants' work.
class TenantRateLimiter {
  private readonly windows = new Map<TenantId, Window>();

  constructor(private readonly clock: Clock) {}

  // Returns null when the attempt is within `perSecond`, or the Date the
  // window resets at when it is not.
  checkAndConsume(tenantId: TenantId, perSecond: number): Date | null {
    const now = this.clock.now().getTime();
    let win = this.windows.get(tenantId);
    if (!win || now - win.windowStart >= 1000) {
      win = { windowStart: now, count: 0 };
      this.windows.set(tenantId, win);
    }
    win.count += 1;
    if (win.count <= perSecond) return null;
    return new Date(win.windowStart + 1000);
  }
}

// ponytail: re-reads the tenant row on every attempt (no cache), so a live
// config change takes effect on the next attempt for that tenant. Add a
// short-TTL cache here if per-attempt storage reads measurably show up under
// production throughput.
export function buildRateLimitDispatcher(
  deps: RateLimitDispatcherDeps,
  baseDispatcher: DispatchOne,
): DispatchOne {
  const limiter = new TenantRateLimiter(deps.clock);

  return async (ctx: DispatchContext, msg, endpoint): Promise<DispatchOutcome> => {
    if (msg.tenantId !== null) {
      const tenant = await deps.storage.tenants.get(msg.tenantId);
      const { rateLimit: rawRateLimit } = tenant?.metadata ?? {};
      const rateLimit = decodeRateLimitStrategy(rawRateLimit ?? null);
      if (rateLimit !== null) {
        const resetAt = limiter.checkAndConsume(msg.tenantId, rateLimit.perSecond);
        if (resetAt !== null) {
          await deps.storage.rescheduleMessage(msg.id, { scheduledFor: resetAt });
          return {
            status: "skipped",
            responseCode: null,
            latencyMs: 0,
            error: "TENANT_RATE_LIMITED",
            keepPending: true,
          };
        }
      }
    }
    return baseDispatcher(ctx, msg, endpoint);
  };
}
