import type { AttemptStatus } from "../../storage/types.js";

export interface OutcomeDecision {
  readonly status: AttemptStatus;
  readonly retryAfterSeconds?: number;
}

export function parseRetryAfter(header: string | null, now: Date): number | undefined {
  if (!header) return undefined;
  const secs = Number.parseInt(header.trim(), 10);
  if (!Number.isNaN(secs) && secs >= 0) return secs;
  const ts = Date.parse(header);
  if (!Number.isNaN(ts)) return Math.max(0, Math.floor((ts - now.getTime()) / 1000));
  return undefined;
}

export function decideFromResponse(
  status: number,
  retryAfterHeader: string | null,
  now: Date,
): OutcomeDecision {
  if (status >= 200 && status < 300) return { status: "success" };
  if (status === 408 || status === 429) {
    const ra = parseRetryAfter(retryAfterHeader, now);
    return ra !== undefined ? { status: "failed", retryAfterSeconds: ra } : { status: "failed" };
  }
  if (status >= 400 && status < 500) return { status: "failed-permanent" };
  return { status: "failed" };
}
