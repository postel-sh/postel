import type {
  EndpointId,
  EndpointRecord,
  EndpointSecretRecord,
  FilterEnvelope,
  MessageId,
  MessageStatus,
  NewAttempt,
  NewMessage,
  Page,
  ReservedMessage,
  StorageCapabilities,
  StoredMessage,
  TenantId,
  TenantRecord,
} from "@postel/core";

export {
  type Migration,
  MYSQL_MIGRATIONS,
  PG_MIGRATIONS,
  SQLITE_MIGRATIONS,
} from "./migrations.js";

// --- Capability flag sets -------------------------------------------------
// Canonical declarations so adapters don't hand-roll them. Postgres can push
// (LISTEN/NOTIFY); SQLite and MySQL cannot and fall back to polling.

export const PG_CAPABILITIES: StorageCapabilities = {
  notify: true,
  subscribe: true,
  transactional: true,
  streaming: true,
};

export const SQLITE_CAPABILITIES: StorageCapabilities = {
  notify: false,
  subscribe: false,
  transactional: true,
  streaming: true,
};

// MySQL has no LISTEN/NOTIFY, so it falls back to polling like SQLite — but it
// is a real multi-connection server with `FOR UPDATE SKIP LOCKED`, so it stays
// transactional and streaming.
export const MYSQL_CAPABILITIES: StorageCapabilities = {
  notify: false,
  subscribe: false,
  transactional: true,
  streaming: true,
};

// The schema version the current library is built against — kept in lockstep
// with the latest forward-only migration in specs/db-schema/. A SQL adapter
// compares this against `_postel_meta.schema_version` for the boot handshake.
export const POSTEL_SCHEMA_VERSION = 5;

// --- Column codec ---------------------------------------------------------
// Three dialect axes diverge at the column boundary: how timestamps and JSON
// are stored. Postgres holds native `timestamptz`/`jsonb` (Date/object
// round-trip); SQLite holds ISO-8601 `TEXT` and JSON `TEXT`; MySQL holds
// `BIGINT` epoch-milliseconds and JSON `TEXT`. Bytes are `Buffer` everywhere.
//
// MySQL timestamps are epoch-milliseconds, not `DATETIME`, on purpose: a
// `BIGINT` is timezone-independent and round-trips identically regardless of
// the host pool's `timezone`/`dateStrings` config — sidestepping the mysql2
// connection-timezone footgun while staying index- and range-query-friendly.

export interface ColumnCodec {
  readonly time: "native" | "iso8601" | "epoch-millis";
  readonly json: "native" | "text";
}

export const PG_CODEC: ColumnCodec = { time: "native", json: "native" };
export const SQLITE_CODEC: ColumnCodec = { time: "iso8601", json: "text" };
export const MYSQL_CODEC: ColumnCodec = { time: "epoch-millis", json: "text" };

export function encodeTimestamp(
  value: Date | null,
  codec: ColumnCodec,
): string | number | Date | null {
  if (value === null) return null;
  if (codec.time === "iso8601") return value.toISOString();
  if (codec.time === "epoch-millis") return value.getTime();
  return value;
}

export function decodeTimestamp(value: unknown, codec: ColumnCodec): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  // MySQL `BIGINT` epoch-ms may surface as a number, a bigint, or a numeric
  // string depending on the driver's bigint config — coerce all three.
  if (codec.time === "epoch-millis") {
    const ms = typeof value === "string" || typeof value === "bigint" ? Number(value) : value;
    if (typeof ms === "number" && Number.isFinite(ms)) return new Date(ms);
    throw new TypeError(
      `storage-helpers: cannot decode epoch-millis timestamp from ${typeof value}`,
    );
  }
  if (typeof value === "string") return new Date(value);
  if (typeof value === "number") return new Date(value);
  if (typeof value === "bigint") return new Date(Number(value));
  throw new TypeError(`storage-helpers: cannot decode timestamp from ${typeof value}`);
}

export function encodeJson(value: unknown, codec: ColumnCodec): unknown {
  if (value === null || value === undefined) return null;
  return codec.json === "text" ? JSON.stringify(value) : value;
}

export function decodeJson<T = unknown>(value: unknown, codec: ColumnCodec): T | null {
  if (value === null || value === undefined) return null;
  if (codec.json === "text" && typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

// Postgres `bytea` and SQLite `BLOB` both surface as a `Buffer` (a Uint8Array
// subclass) and accept a Uint8Array on the way in, so these are pass-through
// today — the seam exists for future K/V stores that base64-encode.
export function encodeBytes(value: Uint8Array): Uint8Array {
  return value;
}

export function decodeBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new TypeError(`storage-helpers: cannot decode bytes from ${typeof value}`);
}

// SQLite stores booleans as 0/1 integers; Postgres as native booleans.
export function decodeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "bigint") return value !== 0n;
  throw new TypeError(`storage-helpers: cannot decode boolean from ${typeof value}`);
}

// --- Retry-policy serialization ------------------------------------------
// The retry policy is an opaque JSON blob; these are named conveniences over
// the JSON codec so adapters express intent (and so the column choice lives in
// one place if it ever diverges from plain JSON).

export function serializeRetryPolicy(policy: unknown, codec: ColumnCodec): unknown {
  return encodeJson(policy, codec);
}

export function deserializeRetryPolicy(value: unknown, codec: ColumnCodec): unknown {
  return decodeJson(value, codec);
}

// --- Idempotency key ------------------------------------------------------
// Composite key used to dedup sends within a tenant. Matches the in-memory
// reference exactly so behavior is identical across adapters.

export function formatIdempotencyKey(
  tenantId: string | null,
  key: string | null,
): string | undefined {
  if (key === null) return undefined;
  return `${tenantId ?? ""}|${key}`;
}

// --- Row encode / decode --------------------------------------------------
// Map domain records to/from canonical snake_case column rows. Encoders return
// the full insert row (defaults included); decoders read a driver row back.

export type Row = Record<string, unknown>;

export function encodeMessageInsert(message: NewMessage, codec: ColumnCodec): Row {
  return {
    id: message.id,
    tenant_id: message.tenantId,
    type: message.type,
    data: encodeJson(message.data, codec),
    channels: encodeJson(message.channels, codec),
    idempotency_key: message.idempotencyKey,
    version: message.version,
    ttl_seconds: message.ttlSeconds,
    created_at: encodeTimestamp(message.createdAt, codec),
    expires_at: encodeTimestamp(message.expiresAt, codec),
    reserved_by: null,
    reserved_at: null,
    lease_expires_at: null,
    status: "pending",
    attempt_number: 0,
    scheduled_for: null,
    replay_of: message.replayOf ?? null,
  };
}

export function decodeReservedMessage(row: Row, codec: ColumnCodec): ReservedMessage {
  const {
    id,
    tenant_id,
    type,
    data,
    channels,
    version,
    created_at,
    expires_at,
    lease_expires_at,
    attempt_number,
    scheduled_for,
    replay_of,
  } = row;
  const createdAt = decodeTimestamp(created_at, codec);
  const leaseExpiresAt = decodeTimestamp(lease_expires_at, codec);
  return {
    id: id as MessageId,
    tenantId: (tenant_id as string | null) ?? null,
    type: type as string,
    data: decodeJson(data, codec),
    channels: decodeJson<ReadonlyArray<string>>(channels, codec),
    version: (version as string | null) ?? null,
    createdAt: createdAt ?? new Date(0),
    expiresAt: decodeTimestamp(expires_at, codec),
    leaseExpiresAt: leaseExpiresAt ?? createdAt ?? new Date(0),
    attemptNumber: Number(attempt_number ?? 0),
    scheduledFor: decodeTimestamp(scheduled_for, codec),
    replayOf: (replay_of as MessageId | null) ?? null,
  };
}

// Conservative default page size for the message-introspection list read.
// Adapters apply this when `MessageListFilter.limit` is omitted.
export const DEFAULT_MESSAGE_LIST_LIMIT = 100;

// Read-shaped decode for getMessage / listMessages. Adds the outbox `status`,
// `idempotency_key`, and `ttl_seconds` that decodeReservedMessage omits.
export function decodeStoredMessage(row: Row, codec: ColumnCodec): StoredMessage {
  const {
    id,
    tenant_id,
    type,
    data,
    channels,
    idempotency_key,
    version,
    ttl_seconds,
    created_at,
    expires_at,
    status,
    attempt_number,
    scheduled_for,
    replay_of,
  } = row;
  return {
    id: id as MessageId,
    tenantId: (tenant_id as string | null) ?? null,
    type: type as string,
    data: decodeJson(data, codec),
    channels: decodeJson<ReadonlyArray<string>>(channels, codec),
    idempotencyKey: (idempotency_key as string | null) ?? null,
    version: (version as string | null) ?? null,
    ttlSeconds: ttl_seconds === null || ttl_seconds === undefined ? null : Number(ttl_seconds),
    createdAt: decodeTimestamp(created_at, codec) ?? new Date(0),
    expiresAt: decodeTimestamp(expires_at, codec),
    status: (status as MessageStatus | undefined) ?? "pending",
    attemptNumber: Number(attempt_number ?? 0),
    scheduledFor: decodeTimestamp(scheduled_for, codec),
    replayOf: (replay_of as MessageId | null) ?? null,
  };
}

// Conservative default page size for the tenant-read list. Adapters apply this
// when `TenantListFilter.limit` is omitted.
export const DEFAULT_TENANT_LIST_LIMIT = 100;

export function decodeTenant(row: Row, codec: ColumnCodec): TenantRecord {
  const { id, metadata, created_at } = row;
  return {
    id: id as TenantId,
    metadata: decodeJson<Record<string, unknown>>(metadata, codec),
    createdAt: decodeTimestamp(created_at, codec) ?? new Date(0),
  };
}

// Opaque keyset cursor over `(createdAt, id)` — the one pagination convention
// every list-returning read shares (endpoints, messages, tenants, reconcile;
// see ADR 0015): base64url of "${createdAtISO} ${id}". Millisecond ISO-8601 is
// the pinned cursor precision — the keyset-ordered created_at columns are
// stored at ms precision (timestamptz(3) / epoch-ms / ms ISO text) so stored
// values round-trip the cursor exactly. Decoding splits on the FIRST space
// only (not `.split(" ")`) because an id may itself contain a space; the ISO
// timestamp never does, so the first occurrence unambiguously separates them.
export function encodeKeysetCursor(rec: { readonly id: string; readonly createdAt: Date }): string {
  const raw = `${rec.createdAt.toISOString()} ${rec.id}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

export function decodeKeysetCursor(str: string): { createdAt: Date; id: string } {
  // Buffer.from(str, "base64url") never throws — it skips invalid characters —
  // so malformed input is caught by the shape checks below, not a try/catch.
  const raw = Buffer.from(str, "base64url").toString("utf8");
  const sep = raw.indexOf(" ");
  if (sep < 0) {
    throw new TypeError(`storage-helpers: cannot decode keyset cursor from ${JSON.stringify(str)}`);
  }
  const createdAtIso = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  const createdAt = new Date(createdAtIso);
  if (id.length === 0 || Number.isNaN(createdAt.getTime())) {
    throw new TypeError(`storage-helpers: cannot decode keyset cursor from ${JSON.stringify(str)}`);
  }
  return { createdAt, id };
}

export function encodeTenantCursor(rec: Pick<TenantRecord, "id" | "createdAt">): string {
  return encodeKeysetCursor(rec);
}

export function decodeTenantCursor(str: string): { createdAt: Date; id: string } {
  return decodeKeysetCursor(str);
}

// Conservative default page sizes for the endpoint list and reconcile reads.
// Adapters apply these when the corresponding filter's `limit` is omitted.
export const DEFAULT_ENDPOINT_LIST_LIMIT = 100;
export const DEFAULT_RECONCILE_LIMIT = 100;

// Slice a limit+1 overfetch into a `Page`: the extra row (if any) only proves
// another page exists — it is dropped, and the cursor points at the last row
// actually returned.
export function pageFromRows<T extends { readonly id: string; readonly createdAt: Date }>(
  rows: ReadonlyArray<T>,
  limit: number,
): Page<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor = rows.length > limit && last ? encodeKeysetCursor(last) : null;
  return { items, nextCursor };
}

export function encodeAttemptInsert(attempt: NewAttempt, codec: ColumnCodec): Row {
  return {
    id: attempt.id,
    message_id: attempt.messageId,
    endpoint_id: attempt.endpointId,
    tenant_id: attempt.tenantId,
    attempt_number: attempt.attemptNumber,
    status: attempt.status,
    scheduled_for: encodeTimestamp(attempt.scheduledFor, codec),
    started_at: encodeTimestamp(attempt.startedAt, codec),
    completed_at: encodeTimestamp(attempt.completedAt, codec),
    response_code: attempt.responseCode,
    response_headers: encodeJson(attempt.responseHeaders, codec),
    response_body: attempt.responseBody,
    latency_ms: attempt.latencyMs,
    error: attempt.error,
    replay_of: attempt.replayOf,
  };
}

export function decodeAttempt(row: Row, codec: ColumnCodec): NewAttempt {
  const {
    id,
    message_id,
    endpoint_id,
    tenant_id,
    attempt_number,
    status,
    scheduled_for,
    started_at,
    completed_at,
    response_code,
    response_headers,
    response_body,
    latency_ms,
    error,
    replay_of,
  } = row;
  return {
    id: id as string,
    messageId: message_id as MessageId,
    endpointId: endpoint_id as EndpointId,
    tenantId: (tenant_id as string | null) ?? null,
    attemptNumber: Number(attempt_number ?? 0),
    status: status as NewAttempt["status"],
    scheduledFor: decodeTimestamp(scheduled_for, codec),
    startedAt: decodeTimestamp(started_at, codec),
    completedAt: decodeTimestamp(completed_at, codec),
    responseCode:
      response_code === null || response_code === undefined ? null : Number(response_code),
    responseHeaders: decodeJson<Record<string, string>>(response_headers, codec),
    responseBody: (response_body as string | null) ?? null,
    latencyMs: latency_ms === null || latency_ms === undefined ? null : Number(latency_ms),
    error: (error as string | null) ?? null,
    replayOf: (replay_of as MessageId | null) ?? null,
  };
}

export function encodeEndpointInsert(endpoint: EndpointRecord, codec: ColumnCodec): Row {
  return {
    id: endpoint.id,
    tenant_id: endpoint.tenantId,
    url: endpoint.url,
    state: endpoint.state,
    types: encodeJson(endpoint.types, codec),
    channels: encodeJson(endpoint.channels, codec),
    filter: encodeJson(endpoint.filter, codec),
    retry_policy: encodeJson(endpoint.retryPolicy, codec),
    headers: encodeJson(endpoint.headers, codec),
    signing: encodeJson(endpoint.signing, codec),
    metadata: encodeJson(endpoint.metadata, codec),
    allow_http: endpoint.allowHttp,
    max_inflight: endpoint.maxInflight,
    http: encodeJson(endpoint.http, codec),
    circuit_breaker: encodeJson(endpoint.circuitBreaker, codec),
    auto_disable: encodeJson(endpoint.autoDisable, codec),
    created_at: encodeTimestamp(endpoint.createdAt, codec),
    updated_at: encodeTimestamp(endpoint.updatedAt, codec),
  };
}

// Decodes the serializable columns (including the real, persisted `filter`)
// into an EndpointRecord with null code-side callbacks. Call `attachCallbacks`
// with the adapter's registry to restore the live `filterFn` / `transform`
// functions.
export function decodeEndpoint(row: Row, codec: ColumnCodec): EndpointRecord {
  const {
    id,
    tenant_id,
    url,
    state,
    types,
    channels,
    filter,
    retry_policy,
    headers,
    signing,
    metadata,
    allow_http,
    max_inflight,
    http,
    circuit_breaker,
    auto_disable,
    created_at,
    updated_at,
  } = row;
  return {
    id: id as EndpointId,
    tenantId: (tenant_id as string | null) ?? null,
    url: url as string,
    state: state as EndpointRecord["state"],
    types: decodeJson<ReadonlyArray<string>>(types, codec),
    channels: decodeJson<ReadonlyArray<string>>(channels, codec),
    filter: decodeJson(filter, codec),
    retryPolicy: decodeJson(retry_policy, codec),
    headers: decodeJson(headers, codec),
    signing: decodeJson(signing, codec),
    metadata: decodeJson<Record<string, unknown>>(metadata, codec),
    allowHttp: decodeBoolean(allow_http ?? false),
    maxInflight: max_inflight === null || max_inflight === undefined ? null : Number(max_inflight),
    http: decodeJson(http, codec),
    circuitBreaker: decodeJson(circuit_breaker, codec),
    autoDisable: decodeJson(auto_disable, codec),
    filterFn: null,
    transform: null,
    createdAt: decodeTimestamp(created_at, codec) ?? new Date(0),
    updatedAt: decodeTimestamp(updated_at, codec) ?? new Date(0),
  };
}

export function encodeSecretInsert(
  secret: Omit<EndpointSecretRecord, "createdAt">,
  codec: ColumnCodec,
): Row {
  const { id, endpointId, algorithm, status, priority, encryptedValue, publicKey, notAfter } =
    secret;
  return {
    id,
    endpoint_id: endpointId,
    algorithm,
    status,
    priority,
    encrypted_value: encodeBytes(encryptedValue),
    public_key: publicKey === undefined ? null : encodeBytes(publicKey),
    not_after: encodeTimestamp(notAfter, codec),
  };
}

export function decodeSecret(row: Row, codec: ColumnCodec): EndpointSecretRecord {
  const {
    id,
    endpoint_id,
    algorithm,
    status,
    priority,
    encrypted_value,
    public_key,
    not_after,
    created_at,
  } = row;
  const publicKey =
    public_key === null || public_key === undefined ? undefined : decodeBytes(public_key);
  return {
    id: id as string,
    endpointId: endpoint_id as EndpointId,
    algorithm: algorithm as EndpointSecretRecord["algorithm"],
    status: status as EndpointSecretRecord["status"],
    priority: Number(priority ?? 0),
    encryptedValue: decodeBytes(encrypted_value),
    ...(publicKey === undefined ? {} : { publicKey }),
    notAfter: decodeTimestamp(not_after, codec),
    createdAt: decodeTimestamp(created_at, codec) ?? new Date(0),
  };
}

// --- Code-side callback registry -----------------------------------------
// `filterFn` / `transform` are JS closures, not serializable. A SQL adapter
// keeps them in this per-instance registry keyed by endpoint id and
// re-attaches them on read. The registry is ephemeral: after a restart the
// host must re-register endpoints (via create/update) for their callbacks to
// take effect again. The structural `filter` is NOT part of this registry —
// it is real, persisted data handled by `encodeEndpointInsert`/`decodeEndpoint`.

export interface EndpointCallbacks {
  readonly filterFn: ((event: FilterEnvelope) => boolean) | null;
  readonly transform: ((event: unknown) => unknown) | null;
}

export interface CallbackRegistry {
  set(id: EndpointId, callbacks: Partial<EndpointCallbacks>): void;
  applyPatch(id: EndpointId, patch: Partial<EndpointCallbacks>): void;
  get(id: EndpointId): EndpointCallbacks;
  delete(id: EndpointId): void;
}

export function createCallbackRegistry(): CallbackRegistry {
  const map = new Map<EndpointId, EndpointCallbacks>();
  return {
    set(id, callbacks) {
      map.set(id, {
        filterFn: callbacks.filterFn ?? null,
        transform: callbacks.transform ?? null,
      });
    },
    applyPatch(id, patch) {
      const current = map.get(id) ?? { filterFn: null, transform: null };
      map.set(id, {
        filterFn: "filterFn" in patch ? (patch.filterFn ?? null) : current.filterFn,
        transform: "transform" in patch ? (patch.transform ?? null) : current.transform,
      });
    },
    get(id) {
      return map.get(id) ?? { filterFn: null, transform: null };
    },
    delete(id) {
      map.delete(id);
    },
  };
}

export function attachCallbacks(
  endpoint: EndpointRecord,
  registry: CallbackRegistry,
): EndpointRecord {
  const { filterFn, transform } = registry.get(endpoint.id);
  return { ...endpoint, filterFn, transform };
}
