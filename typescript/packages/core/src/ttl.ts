import { ConfigurationError } from "./errors.js";

const SUFFIXES: Record<string, number> = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 };
const TTL_RE = /^(\d+)\s*([smhd])$/u;

// Shared duration grammar (see api-surface-typescript spec): an integer number
// of seconds, or a `"<integer><s|m|h|d>"` string. Catches "5 minutes"-style
// typos at compile time instead of at runtime.
export type Duration = number | `${number}${"s" | "m" | "h" | "d"}`;

export function ttlToSeconds(ttl: Duration): number {
  if (typeof ttl === "number") {
    if (!Number.isFinite(ttl) || ttl <= 0 || !Number.isInteger(ttl)) {
      throw new ConfigurationError("duration number must be a positive integer (seconds)");
    }
    return ttl;
  }
  const match = TTL_RE.exec(ttl);
  if (!match) {
    throw new ConfigurationError(
      `duration "${ttl}" must be a number or a "<integer><s|m|h|d>" duration`,
    );
  }
  const [, qty, unit] = match;
  const factor = SUFFIXES[unit as string];
  if (factor === undefined) {
    throw new ConfigurationError(`duration unit "${unit}" is not one of s/m/h/d`);
  }
  return Number(qty) * factor;
}
