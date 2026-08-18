import type { Clock } from "../../clock.js";
import type { Storage } from "../../storage/types.js";
import type { DispatchOne } from "../dispatcher/dispatch.js";
import { type DurationMs, durationToMs } from "../internal/duration.js";
import { newDrainWorkerId } from "../internal/id.js";
import { DEFAULT_BATCH_SIZE, DEFAULT_LEASE_MS, DEFAULT_RENEW_INTERVAL_MS } from "./pool.js";
import { processReservedMessage } from "./process-one.js";

export interface DrainOptions {
  readonly maxMessages: number;
  readonly deadline: DurationMs;
}

export interface DrainResult {
  readonly processed: number;
  readonly reachedDeadline: boolean;
}

export interface DrainContext {
  readonly storage: Storage;
  readonly clock: Clock;
  readonly dispatchOne: DispatchOne;
}

// Bounded, single-pass drain: reserves and dispatches at most `maxMessages`
// messages, stopping earlier if `deadline` elapses. Reuses the same
// reserveBatch/lease mechanism as `Worker`, so it's safe to call alongside a
// running `postel.start()` pool — see "Bounded single-pass drain for
// serverless invocation" in openspec/specs/sender/spec.md. Never starts a
// persistent loop; a single call always resolves.
export async function drainOnce(ctx: DrainContext, opts: DrainOptions): Promise<DrainResult> {
  if (!Number.isInteger(opts.maxMessages) || opts.maxMessages <= 0) {
    throw new RangeError(
      `maxMessages must be a positive integer, received ${String(opts.maxMessages)}`,
    );
  }
  const deadlineAt = ctx.clock.now().getTime() + durationToMs(opts.deadline);
  const workerId = newDrainWorkerId();
  let processed = 0;
  while (processed < opts.maxMessages) {
    if (ctx.clock.now().getTime() >= deadlineAt) {
      return { processed, reachedDeadline: true };
    }
    const batchSize = Math.min(DEFAULT_BATCH_SIZE, opts.maxMessages - processed);
    const batch = await ctx.storage.reserveBatch({
      workerId,
      leaseMs: DEFAULT_LEASE_MS,
      batchSize,
      now: ctx.clock.now(),
    });
    if (batch.length === 0) {
      return { processed, reachedDeadline: false };
    }
    await Promise.all(
      batch.map((msg) =>
        processReservedMessage(
          {
            storage: ctx.storage,
            clock: ctx.clock,
            dispatchOne: ctx.dispatchOne,
            workerId,
            leaseMs: DEFAULT_LEASE_MS,
            renewIntervalMs: DEFAULT_RENEW_INTERVAL_MS,
          },
          msg,
        ),
      ),
    );
    processed += batch.length;
  }
  return { processed, reachedDeadline: false };
}
