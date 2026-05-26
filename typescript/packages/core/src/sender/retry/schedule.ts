import { ExponentialBackoff, type RetryStrategy } from "../../strategies/retry.js";
import { durationToMs } from "../internal/duration.js";

export interface ScheduleDecision {
  readonly nextAttemptAt: Date | null;
  readonly attemptNumber: number;
  readonly exhausted: boolean;
}

export function resolveStrategy(
  endpointPolicy: RetryStrategy | null | undefined,
  orgPolicy: RetryStrategy | undefined,
): RetryStrategy {
  return endpointPolicy ?? orgPolicy ?? ExponentialBackoff();
}

function applyJitter(delayMs: number, jitter: number, rng: () => number): number {
  if (jitter <= 0) return delayMs;
  const range = delayMs * jitter;
  const shift = (rng() * 2 - 1) * range;
  return Math.max(0, Math.floor(delayMs + shift));
}

function delayMsForAttempt(strategy: RetryStrategy, failedAttempts: number): number {
  if (strategy.kind === "exponential") {
    const idx = Math.min(failedAttempts, strategy.schedule.length - 1);
    const entry = strategy.schedule[idx];
    if (entry === undefined) return 0;
    return durationToMs(entry);
  }
  if (strategy.kind === "linear") {
    return durationToMs(strategy.step);
  }
  return durationToMs(strategy.compute(failedAttempts));
}

export function nextSchedule(
  strategy: RetryStrategy,
  failedAttempts: number,
  retryAfterSeconds: number | undefined,
  now: Date,
  rng: () => number = Math.random,
): ScheduleDecision {
  if (failedAttempts >= strategy.maxAttempts) {
    return { nextAttemptAt: null, attemptNumber: failedAttempts, exhausted: true };
  }
  let delayMs = delayMsForAttempt(strategy, failedAttempts);
  if (retryAfterSeconds !== undefined && retryAfterSeconds * 1000 > delayMs) {
    delayMs = retryAfterSeconds * 1000;
  }
  const jitter = strategy.kind === "exponential" ? strategy.jitter : 0;
  delayMs = applyJitter(delayMs, jitter, rng);
  return {
    nextAttemptAt: new Date(now.getTime() + delayMs),
    attemptNumber: failedAttempts + 1,
    exhausted: false,
  };
}
