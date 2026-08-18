import type { Clock } from "../../clock.js";
import { spanAttributes, withSpan } from "../../observability/tracing.js";
import type { ReservedMessage, Storage, TenantId, WorkerId } from "../../storage/types.js";
import { type DispatchOne, dispatchMessage } from "../dispatcher/dispatch.js";

export interface WorkerOptions {
  readonly id: WorkerId;
  readonly storage: Storage;
  readonly clock: Clock;
  readonly dispatchOne: DispatchOne;
  readonly batchSize: number;
  readonly leaseMs: number;
  readonly idleMs: number;
  readonly renewIntervalMs: number;
}

// TS reference scheduling algorithm for "Worker fairness across tenants"
// (openspec/specs/multi-tenancy/spec.md): PORT-SPECIFIC mechanism, CONTRACT
// outcome. A tenant holds the worker for at most this many consecutive
// dispatch cycles before rotation yields to the next tenant with backlog,
// bounding how long any other tenant can be starved by a burst.
export const MAX_DISPATCH_CYCLES_PER_TENANT = 10;

// Round-robins reservation across tenants that have pending backlog.
// `refresh` re-derives membership from a fresh countPendingByTenant() read
// (tenant-less "_null" rows are excluded — they fall through to the
// unfiltered sweep in Worker.runLoop instead), preserving the current
// tenant's turn when it's still active.
class TenantRotation {
  private tenants: ReadonlyArray<TenantId> = [];
  private index = 0;
  private cyclesOnCurrent = 0;

  refresh(counts: ReadonlyMap<TenantId | "_null", number>): void {
    const current = this.tenants[this.index];
    this.tenants = [...counts.keys()].filter((id): id is TenantId => id !== "_null").sort();
    this.index = current !== undefined ? Math.max(this.tenants.indexOf(current), 0) : 0;
    this.cyclesOnCurrent = 0;
  }

  current(): TenantId | undefined {
    return this.tenants[this.index];
  }

  size(): number {
    return this.tenants.length;
  }

  recordCycle(dispatchedAny: boolean): void {
    this.cyclesOnCurrent += 1;
    if (dispatchedAny && this.cyclesOnCurrent < MAX_DISPATCH_CYCLES_PER_TENANT) return;
    this.cyclesOnCurrent = 0;
    if (this.tenants.length > 0) this.index = (this.index + 1) % this.tenants.length;
  }
}

export class Worker {
  private readonly opts: WorkerOptions;
  private stopping = false;
  private active = 0;
  private wakeResolver: (() => void) | null = null;
  private inFlight: Promise<void> = Promise.resolve();
  private readonly rotation = new TenantRotation();
  // Forces a rotation refresh on the very first iteration.
  private cyclesSinceRefresh = MAX_DISPATCH_CYCLES_PER_TENANT;
  // Consecutive empty reservations across the current rotation; once it
  // reaches the rotation width, a full pass found nothing and it's safe to
  // idle rather than busy-loop querying each tenant in turn.
  private emptyStreak = 0;

  constructor(opts: WorkerOptions) {
    this.opts = opts;
  }

  wake(): void {
    if (this.wakeResolver) {
      this.wakeResolver();
      this.wakeResolver = null;
    }
  }

  async runLoop(): Promise<void> {
    while (!this.stopping) {
      this.cyclesSinceRefresh += 1;
      if (this.cyclesSinceRefresh >= MAX_DISPATCH_CYCLES_PER_TENANT) {
        this.cyclesSinceRefresh = 0;
        this.rotation.refresh(await this.opts.storage.countPendingByTenant());
      }
      const tenantId = this.rotation.current();
      const batch = await this.opts.storage.reserveBatch({
        workerId: this.opts.id,
        leaseMs: this.opts.leaseMs,
        batchSize: this.opts.batchSize,
        ...(tenantId !== undefined ? { tenantId } : {}),
        now: this.opts.clock.now(),
      });
      if (tenantId !== undefined) this.rotation.recordCycle(batch.length > 0);
      if (batch.length === 0) {
        this.emptyStreak += 1;
        if (this.emptyStreak >= Math.max(this.rotation.size(), 1)) {
          this.emptyStreak = 0;
          await this.idleSleep();
        }
        continue;
      }
      this.emptyStreak = 0;
      this.inFlight = Promise.all(batch.map((m) => this.processOne(m))).then(() => undefined);
      await this.inFlight;
    }
  }

  async drain(): Promise<void> {
    this.stopping = true;
    this.wake();
    await this.inFlight;
  }

  private idleSleep(): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.wakeResolver = null;
        resolve();
      }, this.opts.idleMs);
      this.wakeResolver = () => {
        clearTimeout(timer);
        resolve();
      };
      if (this.stopping) {
        clearTimeout(timer);
        this.wakeResolver = null;
        resolve();
      }
    });
  }

  private async processOne(msg: ReservedMessage): Promise<void> {
    this.active += 1;
    const renewTimer = setInterval(() => {
      this.opts.storage
        .renewLease(msg.id, this.opts.id, this.opts.leaseMs, this.opts.clock.now())
        .catch(() => {
          // Swallow transient renew failures: the lease simply expires and the
          // janitor reclaims the message. An unhandled rejection from a storage
          // adapter here could otherwise crash the worker process.
        });
    }, this.opts.renewIntervalMs);
    try {
      await withSpan(
        "postel.dispatch",
        spanAttributes({ "postel.message.id": msg.id, "postel.tenant.id": msg.tenantId }),
        () =>
          dispatchMessage(
            { storage: this.opts.storage, clock: this.opts.clock },
            msg,
            this.opts.dispatchOne,
          ),
      );
      await this.opts.storage.releaseLease(msg.id, this.opts.id);
    } catch {
      // An unexpected dispatch error must not kill the worker loop. Leave the
      // lease to expire so the janitor (expireStaleLeases) reclaims the message
      // with natural backoff rather than hot-looping; another worker retries it.
    } finally {
      clearInterval(renewTimer);
      this.active -= 1;
    }
  }

  activeCount(): number {
    return this.active;
  }
}
