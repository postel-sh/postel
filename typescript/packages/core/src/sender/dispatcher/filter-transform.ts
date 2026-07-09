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

// `value` is genuinely `unknown` at runtime (it's whatever the caller passed
// to `send({ data })`) even though `equals` is a trusted, statically-known
// `Json` literal from config — so this only trusts the *shape* of `equals`,
// never assumes `value` conforms. `seen` guards against cycles in `value`
// (`equals` is a plain literal and can't contain one); non-plain objects
// (Date, Map, class instances, …) are never treated as matching JSON data.
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isJsonArray(v: Json): v is ReadonlyArray<Json> {
  return Array.isArray(v);
}

function jsonDeepEqual(
  value: unknown,
  equals: Json,
  seen: WeakSet<object> = new WeakSet(),
): boolean {
  if (value === equals) return true;
  if (equals === null) return false;
  if (isJsonArray(equals)) {
    if (!Array.isArray(value) || value.length !== equals.length) return false;
    if (seen.has(value)) return false;
    seen.add(value);
    return equals.every((item, i) => jsonDeepEqual(value[i], item, seen));
  }
  if (typeof equals === "object") {
    if (!isPlainObject(value)) return false;
    if (seen.has(value)) return false;
    seen.add(value);
    const equalsKeys = Object.keys(equals);
    if (equalsKeys.length !== Object.keys(value).length) return false;
    return equalsKeys.every(
      (key) => Object.hasOwn(value, key) && jsonDeepEqual(value[key], equals[key] as Json, seen),
    );
  }
  return false;
}

function resolveDataPath(data: unknown, dataPath: string): unknown {
  const segments = dataPath.split(".");
  if (segments.some((segment) => segment.length === 0)) return undefined;
  let cursor: unknown = data;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function matchesClause(clause: StructuralFilterClause, data: unknown): boolean {
  const value = resolveDataPath(data, clause.dataPath);
  if (value === undefined) return false;
  return jsonDeepEqual(value, clause.equals);
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
