const DURATION_RE = /^(\d+)\s*(ms|s|m|h|d)$/u;
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function durationToMs(input: number | string): number {
  if (typeof input === "number") return input;
  const match = DURATION_RE.exec(input);
  if (!match) {
    throw new Error(`duration "${input}" must be a number or "<integer><ms|s|m|h|d>"`);
  }
  const [, qty, unit] = match;
  const factor = UNIT_MS[unit as string];
  if (factor === undefined) throw new Error(`unsupported duration unit ${unit}`);
  return Number(qty) * factor;
}
