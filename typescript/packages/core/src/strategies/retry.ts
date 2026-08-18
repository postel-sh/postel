import type { DurationMs } from "../sender/internal/duration.js";

export type RetryStrategy =
  | {
      readonly kind: "exponential";
      readonly schedule: ReadonlyArray<DurationMs>;
      readonly jitter: number;
      readonly maxAttempts: number;
    }
  | {
      readonly kind: "linear";
      readonly step: DurationMs;
      readonly maxAttempts: number;
    }
  | {
      readonly kind: "custom";
      readonly compute: (attempt: number) => DurationMs;
      readonly maxAttempts: number;
    };

export interface ExponentialBackoffOptions {
  readonly schedule?: ReadonlyArray<DurationMs>;
  readonly jitter?: number;
  readonly maxAttempts?: number;
}

const DEFAULT_EXPONENTIAL_SCHEDULE: ReadonlyArray<DurationMs> = [
  "5s",
  "5m",
  "30m",
  "2h",
  "5h",
  "10h",
  "1d",
  "2d",
  "3d",
];

export function ExponentialBackoff(options?: ExponentialBackoffOptions): RetryStrategy {
  const schedule = options?.schedule ?? DEFAULT_EXPONENTIAL_SCHEDULE;
  return {
    kind: "exponential",
    schedule,
    jitter: options?.jitter ?? 0.2,
    maxAttempts: options?.maxAttempts ?? schedule.length,
  };
}

export interface LinearBackoffOptions {
  readonly step: DurationMs;
  readonly maxAttempts: number;
}

export function LinearBackoff(options: LinearBackoffOptions): RetryStrategy {
  return { kind: "linear", step: options.step, maxAttempts: options.maxAttempts };
}

export interface CustomRetryOptions {
  readonly compute: (attempt: number) => DurationMs;
  readonly maxAttempts: number;
}

export function Custom(options: CustomRetryOptions): RetryStrategy {
  return { kind: "custom", compute: options.compute, maxAttempts: options.maxAttempts };
}
