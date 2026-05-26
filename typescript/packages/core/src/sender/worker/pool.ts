import type { Clock } from "../../clock.js";
import type { Storage } from "../../storage/types.js";
import { type DispatchOne, stubDispatchOne } from "../dispatcher/dispatch.js";
import { Worker } from "./worker.js";

export interface WorkerPoolOptions {
  readonly storage: Storage;
  readonly clock: Clock;
  readonly concurrency: number;
  readonly dispatchOne?: DispatchOne;
  readonly batchSize?: number;
  readonly leaseMs?: number;
  readonly idleMs?: number;
  readonly renewIntervalMs?: number;
  readonly janitorIntervalMs?: number;
}

export class WorkerPool {
  private readonly opts: Required<Omit<WorkerPoolOptions, "dispatchOne">> & {
    readonly dispatchOne: DispatchOne;
  };
  private workers: Worker[] = [];
  private loops: Promise<void>[] = [];
  private janitor: ReturnType<typeof setInterval> | null = null;
  private notifyUnsub: (() => void) | null = null;
  private started = false;

  constructor(opts: WorkerPoolOptions) {
    this.opts = {
      storage: opts.storage,
      clock: opts.clock,
      concurrency: opts.concurrency,
      dispatchOne: opts.dispatchOne ?? stubDispatchOne,
      batchSize: opts.batchSize ?? 16,
      leaseMs: opts.leaseMs ?? 60_000,
      idleMs: opts.idleMs ?? 100,
      renewIntervalMs: opts.renewIntervalMs ?? 20_000,
      janitorIntervalMs: opts.janitorIntervalMs ?? 30_000,
    };
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (let i = 0; i < this.opts.concurrency; i++) {
      const w = new Worker({
        id: `w-${i}`,
        storage: this.opts.storage,
        clock: this.opts.clock,
        dispatchOne: this.opts.dispatchOne,
        batchSize: this.opts.batchSize,
        leaseMs: this.opts.leaseMs,
        idleMs: this.opts.idleMs,
        renewIntervalMs: this.opts.renewIntervalMs,
      });
      this.workers.push(w);
      this.loops.push(w.runLoop());
    }
    if (this.opts.storage.capabilities.subscribe && this.opts.storage.subscribe) {
      this.notifyUnsub = this.opts.storage.subscribe("postel_messages_new", () => {
        for (const w of this.workers) w.wake();
      });
    }
    this.janitor = setInterval(() => {
      void this.opts.storage.expireStaleLeases(this.opts.clock.now());
    }, this.opts.janitorIntervalMs);
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.notifyUnsub) {
      this.notifyUnsub();
      this.notifyUnsub = null;
    }
    if (this.janitor !== null) {
      clearInterval(this.janitor);
      this.janitor = null;
    }
    await Promise.all(this.workers.map((w) => w.drain()));
    await Promise.all(this.loops);
    this.workers = [];
    this.loops = [];
  }

  workerCount(): number {
    return this.workers.length;
  }
}
