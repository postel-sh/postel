import type { Clock } from "../../clock.js";
import { spanAttributes, withSpan } from "../../observability/tracing.js";
import type { ReservedMessage, Storage, WorkerId } from "../../storage/types.js";
import { type DispatchOne, dispatchMessage } from "../dispatcher/dispatch.js";

export interface ProcessReservedMessageOptions {
  readonly storage: Storage;
  readonly clock: Clock;
  readonly dispatchOne: DispatchOne;
  readonly workerId: WorkerId;
  readonly leaseMs: number;
  readonly renewIntervalMs: number;
}

// Shared by the long-lived `Worker` and the bounded `drainOnce`: renews the
// lease while dispatch is in flight, dispatches, then releases the lease on
// success. Errors are swallowed — the lease simply expires and the janitor
// (expireStaleLeases) reclaims the message with natural backoff rather than
// hot-looping; another reserver retries it.
export async function processReservedMessage(
  opts: ProcessReservedMessageOptions,
  msg: ReservedMessage,
): Promise<void> {
  const renewTimer = setInterval(() => {
    opts.storage.renewLease(msg.id, opts.workerId, opts.leaseMs, opts.clock.now()).catch(() => {
      // Swallow transient renew failures: the lease simply expires and the
      // janitor reclaims the message. An unhandled rejection here could
      // otherwise crash the caller's process.
    });
  }, opts.renewIntervalMs);
  try {
    await withSpan(
      "postel.dispatch",
      spanAttributes({ "postel.message.id": msg.id, "postel.tenant.id": msg.tenantId }),
      () => dispatchMessage({ storage: opts.storage, clock: opts.clock }, msg, opts.dispatchOne),
    );
    await opts.storage.releaseLease(msg.id, opts.workerId);
  } catch {
    // An unexpected dispatch error must not propagate to the caller's loop;
    // leave the lease to expire so another reserver retries the message.
  } finally {
    clearInterval(renewTimer);
  }
}
