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

/**
 * @deprecated Not implemented yet — no dispatch runtime has shipped for this strategy.
 * Configuring `outbound.workers` with it throws `NotImplementedError` at construction.
 * Use `InProcess()` instead.
 */
export function BullMQ(queue: unknown): WorkerStrategy {
  return { kind: "bullmq", queue };
}

/**
 * @deprecated Not implemented yet — no dispatch runtime has shipped for this strategy.
 * Configuring `outbound.workers` with it throws `NotImplementedError` at construction.
 * Use `InProcess()` instead.
 */
export function PgBoss(boss: unknown): WorkerStrategy {
  return { kind: "pg-boss", boss };
}

/**
 * @deprecated Not implemented yet — no dispatch runtime has shipped for this strategy.
 * Configuring `outbound.workers` with it throws `NotImplementedError` at construction.
 * Use `InProcess()` instead.
 */
export function External(adapter: unknown): WorkerStrategy {
  return { kind: "external", adapter };
}
