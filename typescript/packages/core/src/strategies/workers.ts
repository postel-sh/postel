export type WorkerStrategy =
  | { readonly kind: "in-process"; readonly concurrency: number }
  | { readonly kind: "bullmq"; readonly queue: unknown }
  | { readonly kind: "pg-boss"; readonly boss: unknown }
  | { readonly kind: "external"; readonly adapter: unknown };

export interface InProcessOptions {
  readonly concurrency?: number;
}

export function InProcess(options?: InProcessOptions): WorkerStrategy {
  return { kind: "in-process", concurrency: options?.concurrency ?? 4 };
}

export function BullMQ(queue: unknown): WorkerStrategy {
  return { kind: "bullmq", queue };
}

export function PgBoss(boss: unknown): WorkerStrategy {
  return { kind: "pg-boss", boss };
}

export function External(adapter: unknown): WorkerStrategy {
  return { kind: "external", adapter };
}
