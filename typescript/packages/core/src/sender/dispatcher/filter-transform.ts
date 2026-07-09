import type {
  FilterEnvelope,
  Json,
  StructuralFilter,
  StructuralFilterClause,
} from "../../outbound.js";
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

function jsonDeepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => jsonDeepEqual(item, b[i] as Json));
  }
  const aObj = a as Readonly<Record<string, Json>>;
  const bObj = b as Readonly<Record<string, Json>>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => key in bObj && jsonDeepEqual(aObj[key] as Json, bObj[key] as Json));
}

function resolveDataPath(data: unknown, dataPath: string): unknown {
  let cursor: unknown = data;
  for (const segment of dataPath.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function matchesClause(clause: StructuralFilterClause, data: unknown): boolean {
  const value = resolveDataPath(data, clause.dataPath);
  if (value === undefined) return false;
  return jsonDeepEqual(value as Json, clause.equals);
}

function matchesStructuralFilter(filter: StructuralFilter, data: unknown): boolean {
  const clauses = Array.isArray(filter) ? filter : [filter];
  return clauses.every((clause) => matchesClause(clause, data));
}

function toEnvelope(msg: ReservedMessage): FilterEnvelope {
  return {
    type: msg.type,
    data: msg.data,
    ...(msg.channels !== null ? { channels: msg.channels } : {}),
    timestamp: msg.createdAt.toISOString(),
  };
}

export function evaluateFilter(
  endpoint: EndpointRecord,
  msg: ReservedMessage,
  predicate?: (event: FilterEnvelope) => boolean,
): FilterResult {
  if (endpoint.types !== null && endpoint.types.length > 0) {
    if (!matchesAnyType(endpoint.types, msg.type)) return { mode: "filtered" };
  }
  if (endpoint.channels !== null && endpoint.channels.length > 0) {
    if (msg.channels === null || msg.channels.length === 0) return { mode: "filtered" };
    if (!intersects(endpoint.channels, msg.channels)) return { mode: "filtered" };
  }
  if (endpoint.filter !== null && !matchesStructuralFilter(endpoint.filter, msg.data)) {
    return { mode: "filtered" };
  }
  if (predicate !== undefined) {
    try {
      const ok = predicate(toEnvelope(msg));
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
  transform?: (event: FilterEnvelope) => unknown,
): TransformResult {
  const defaultBody = {
    type: msg.type,
    timestamp: msg.createdAt.toISOString(),
    data: msg.data,
    ...(msg.channels !== null ? { channels: msg.channels } : {}),
  };
  if (transform === undefined) return { skip: false, body: defaultBody };
  try {
    const result = transform(toEnvelope(msg));
    if (result === null || result === undefined) return { skip: true, body: defaultBody };
    return { skip: false, body: result };
  } catch (e) {
    return { skip: false, error: (e as Error).message, body: defaultBody };
  }
}
