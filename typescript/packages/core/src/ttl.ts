import { MalformedHeader } from "./errors.js";

const SUFFIXES: Record<string, number> = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 };
const TTL_RE = /^(\d+)\s*([smhd])$/u;

export function ttlToSeconds(ttl: number | string): number {
  if (typeof ttl === "number") {
    if (!Number.isFinite(ttl) || ttl <= 0 || !Number.isInteger(ttl)) {
      throw new MalformedHeader("dedup: ttl number must be a positive integer (seconds)");
    }
    return ttl;
  }
  const match = TTL_RE.exec(ttl);
  if (!match) {
    throw new MalformedHeader(
      `dedup: ttl "${ttl}" must be a number or a "<integer><s|m|h|d>" duration`,
    );
  }
  const [, qty, unit] = match;
  const factor = SUFFIXES[unit as string];
  if (factor === undefined) {
    throw new MalformedHeader(`dedup: ttl unit "${unit}" is not one of s/m/h/d`);
  }
  return Number(qty) * factor;
}
