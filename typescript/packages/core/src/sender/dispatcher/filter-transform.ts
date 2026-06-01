import type { EndpointRecord, ReservedMessage } from "../../storage/types.js";

export type FilterMode = "match" | "filtered" | "error";

export interface FilterResult {
  readonly mode: FilterMode;
  readonly error?: string;
}

function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp(
    `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+")}$`,
  );
  return re.test(value);
}

function matchesAnyType(types: ReadonlyArray<string>, type: string): boolean {
  for (const pattern of types) {
    if (pattern === type) return true;
    if (pattern.includes("*") && globMatch(pattern, type)) return true;
  }
  return false;
}

function intersects(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  const set = new Set(b);
  for (const item of a) if (set.has(item)) return true;
  return false;
}

export function evaluateFilter(
  endpoint: EndpointRecord,
  msg: ReservedMessage,
  predicate?: (event: unknown) => boolean,
): FilterResult {
  if (endpoint.types !== null && endpoint.types.length > 0) {
    if (!matchesAnyType(endpoint.types, msg.type)) return { mode: "filtered" };
  }
  if (endpoint.channels !== null && endpoint.channels.length > 0) {
    if (msg.channels === null || msg.channels.length === 0) return { mode: "filtered" };
    if (!intersects(endpoint.channels, msg.channels)) return { mode: "filtered" };
  }
  if (predicate !== undefined) {
    try {
      const ok = predicate({
        type: msg.type,
        data: msg.data,
        channels: msg.channels,
        timestamp: msg.createdAt.toISOString(),
      });
      if (!ok) return { mode: "filtered" };
    } catch (e) {
      return { mode: "error", error: (e as Error).message };
    }
  }
  return { mode: "match" };
}

export interface TransformResult {
  readonly skip: boolean;
  readonly error?: string;
  readonly body: unknown;
}

export function evaluateTransform(
  msg: ReservedMessage,
  transform?: (event: unknown) => unknown,
): TransformResult {
  const defaultBody = {
    type: msg.type,
    timestamp: msg.createdAt.toISOString(),
    data: msg.data,
    ...(msg.channels !== null ? { channels: msg.channels } : {}),
  };
  if (transform === undefined) return { skip: false, body: defaultBody };
  try {
    const result = transform({
      type: msg.type,
      data: msg.data,
      channels: msg.channels,
      timestamp: msg.createdAt.toISOString(),
    });
    if (result === null || result === undefined) return { skip: true, body: defaultBody };
    return { skip: false, body: result };
  } catch (e) {
    return { skip: false, error: (e as Error).message, body: defaultBody };
  }
}
