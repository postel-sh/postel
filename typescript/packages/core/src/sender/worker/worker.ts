import type { Clock } from "../../clock.js";
import type { ReservedMessage, Storage, WorkerId } from "../../storage/types.js";
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

export class Worker {
  private readonly opts: WorkerOptions;
  private stopping = false;
  private active = 0;
  private wakeResolver: (() => void) | null = null;
  private inFlight: Promise<void> = Promise.resolve();

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
      const batch = await this.opts.storage.reserveBatch({
        workerId: this.opts.id,
        leaseMs: this.opts.leaseMs,
        batchSize: this.opts.batchSize,
        now: this.opts.clock.now(),
      });
      if (batch.length === 0) {
        await this.idleSleep();
        continue;
      }
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
      void this.opts.storage.renewLease(
        msg.id,
        this.opts.id,
        this.opts.leaseMs,
        this.opts.clock.now(),
      );
    }, this.opts.renewIntervalMs);
    try {
      await dispatchMessage(
        { storage: this.opts.storage, clock: this.opts.clock },
        msg,
        this.opts.dispatchOne,
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
