import type {
  AttemptStatsResult,
  Clock,
  EndpointId,
  EndpointRecord,
  EndpointSecretRecord,
  EndpointState,
  EndpointStateTransition,
  EndpointWithSecrets,
  HostTxOption,
  InsertOrReuseResult,
  MessageId,
  MessageListFilter,
  NewAttempt,
  NewMessage,
  RangeQueryFilter,
  ReconcileFilter,
  RescheduleOpts,
  ReserveBatchOpts,
  ReservedMessage,
  Storage,
  TenantId,
  TenantRecord,
} from "@postel/core";
import {
  DEFAULT_MESSAGE_LIST_LIMIT,
  SQLITE_CAPABILITIES,
  SQLITE_CODEC,
  SQLITE_MIGRATIONS,
  attachCallbacks,
  createCallbackRegistry,
  decodeAttempt,
  decodeEndpoint,
  decodeReservedMessage,
  decodeSecret,
  decodeStoredMessage,
  encodeAttemptInsert,
  encodeEndpointInsert,
  encodeMessageInsert,
  encodeSecretInsert,
} from "@postel/storage-helpers";
import DatabaseConstructor, { type Database } from "better-sqlite3";

// A transaction handle is just a marker that a BEGIN is open on the single
// connection — writes given one run inline rather than opening their own.
export interface SqliteTx {
  active: boolean;
}

export interface SqliteStorageOptions {
  // An existing better-sqlite3 Database, or a filename (`:memory:` by default)
  // for Postel to own.
  readonly db?: Database;
  readonly filename?: string;
  readonly clock?: Clock;
  // Run migrations on construction (default true).
  readonly autoMigrate?: boolean;
}

const codec = SQLITE_CODEC;

function iso(date: Date): string {
  return date.toISOString();
}

// better-sqlite3 binds only number | bigint | string | Buffer | null. Normalize
// the helper rows: booleans -> 0/1, undefined -> null, Uint8Array -> Buffer.
function bindable(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (typeof value === "boolean") out[key] = value ? 1 : 0;
    else if (value === undefined) out[key] = null;
    else if (value instanceof Uint8Array && !Buffer.isBuffer(value)) out[key] = Buffer.from(value);
    else out[key] = value;
  }
  return out;
}

const FAILURE_STATUSES = new Set([
  "failed",
  "failed-permanent",
  "dead-letter",
  "ssrf-blocked",
  "expired",
]);

export function SqliteStorage(options: SqliteStorageOptions = {}): Storage<SqliteTx> {
  const db: Database = options.db ?? new DatabaseConstructor(options.filename ?? ":memory:");
  // The library maintains referential integrity application-side (matching the
  // in-memory reference, which permits e.g. an attempt for an endpoint that was
  // never persisted) and runs ON DELETE CASCADE manually in delete paths, so
  // SQLite's FK enforcement stays off — the canonical FKs are documentary.
  db.pragma("foreign_keys = OFF");
  const clock: Clock = options.clock ?? { now: () => new Date(), sleep: async () => {} };
  const registry = createCallbackRegistry();

  function migrate(): void {
    let current = 0;
    try {
      const row = db.prepare("SELECT value FROM _postel_meta WHERE key = 'schema_version'").get() as
        | { value?: string }
        | undefined;
      if (row?.value !== undefined) current = Number(row.value);
    } catch {
      current = 0;
    }
    for (const m of SQLITE_MIGRATIONS) {
      if (m.version > current) db.exec(m.sql);
    }
    // Receiver-side dedup lives in its own (non-canonical) table the adapter owns.
    db.exec(
      `CREATE TABLE IF NOT EXISTS postel_received_messages (
         message_id TEXT PRIMARY KEY,
         expires_at INTEGER NOT NULL
       )`,
    );
  }

  if (options.autoMigrate !== false) migrate();

  // Run fn inside its own transaction unless a host transaction is already open
  // (single connection — nesting a BEGIN would error).
  function atomic<R>(tx: SqliteTx | undefined, fn: () => R): R {
    if (tx?.active) return fn();
    return db.transaction(fn)();
  }

  function loadEndpointRecord(id: EndpointId): EndpointRecord | undefined {
    const row = db.prepare("SELECT * FROM endpoints WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return attachCallbacks(decodeEndpoint(row, codec), registry);
  }

  return {
    capabilities: SQLITE_CAPABILITIES,

    async schemaVersion() {
      const row = db.prepare("SELECT value FROM _postel_meta WHERE key = 'schema_version'").get() as
        | { value?: string }
        | undefined;
      return row?.value === undefined ? 0 : Number(row.value);
    },

    async insertMessage(msg: NewMessage, opts?: HostTxOption<SqliteTx>) {
      const row = bindable(encodeMessageInsert(msg, codec));
      db.prepare(
        `INSERT INTO messages
           (id, tenant_id, type, data, channels, idempotency_key, version, ttl_seconds,
            created_at, expires_at, reserved_by, reserved_at, lease_expires_at, status,
            attempt_number, scheduled_for, replay_of)
         VALUES
           (@id, @tenant_id, @type, @data, @channels, @idempotency_key, @version, @ttl_seconds,
            @created_at, @expires_at, @reserved_by, @reserved_at, @lease_expires_at, @status,
            @attempt_number, @scheduled_for, @replay_of)`,
      ).run(row);
      void opts;
      return msg.id;
    },

    async insertOrReuseByIdempotencyKey(
      msg: NewMessage,
      opts?: HostTxOption<SqliteTx>,
    ): Promise<InsertOrReuseResult> {
      if (msg.idempotencyKey === null) {
        const id = await this.insertMessage(msg, opts);
        return { id, reused: false };
      }
      return atomic(opts?.tx, () => {
        const existing = db
          .prepare(
            "SELECT id FROM messages WHERE tenant_id IS @tenant AND idempotency_key = @key LIMIT 1",
          )
          .get({ tenant: msg.tenantId, key: msg.idempotencyKey }) as { id?: string } | undefined;
        if (existing?.id !== undefined) return { id: existing.id, reused: true };
        const row = bindable(encodeMessageInsert(msg, codec));
        db.prepare(
          `INSERT INTO messages
             (id, tenant_id, type, data, channels, idempotency_key, version, ttl_seconds,
              created_at, expires_at, reserved_by, reserved_at, lease_expires_at, status,
              attempt_number, scheduled_for, replay_of)
           VALUES
             (@id, @tenant_id, @type, @data, @channels, @idempotency_key, @version, @ttl_seconds,
              @created_at, @expires_at, @reserved_by, @reserved_at, @lease_expires_at, @status,
              @attempt_number, @scheduled_for, @replay_of)`,
        ).run(row);
        return { id: msg.id, reused: false };
      });
    },

    async reserveBatch(opts: ReserveBatchOpts): Promise<ReadonlyArray<ReservedMessage>> {
      const now = iso(opts.now);
      const leaseExpiresAt = iso(new Date(opts.now.getTime() + opts.leaseMs));
      const reserve = db.transaction(() => {
        return db
          .prepare(
            `UPDATE messages
               SET reserved_by = @worker, reserved_at = @now,
                   lease_expires_at = @lease, attempt_number = attempt_number + 1
             WHERE id IN (
               SELECT id FROM messages
               WHERE status = 'pending' AND reserved_by IS NULL
                 AND (@tenant IS NULL OR tenant_id = @tenant)
                 AND (scheduled_for IS NULL OR scheduled_for <= @now)
               ORDER BY COALESCE(scheduled_for, created_at), id
               LIMIT @batch
             )
             RETURNING *`,
          )
          .all({
            worker: opts.workerId,
            now,
            lease: leaseExpiresAt,
            tenant: opts.tenantId ?? null,
            batch: opts.batchSize,
          }) as Record<string, unknown>[];
      });
      const rows = reserve.immediate();
      return rows.map((row) => decodeReservedMessage(row, codec));
    },

    async recordAttempt(attempt: NewAttempt, opts?: HostTxOption<SqliteTx>) {
      const row = bindable(encodeAttemptInsert(attempt, codec));
      db.prepare(
        `INSERT INTO attempts
           (id, message_id, endpoint_id, tenant_id, attempt_number, status, scheduled_for,
            started_at, completed_at, response_code, response_headers, response_body,
            latency_ms, error, replay_of)
         VALUES
           (@id, @message_id, @endpoint_id, @tenant_id, @attempt_number, @status, @scheduled_for,
            @started_at, @completed_at, @response_code, @response_headers, @response_body,
            @latency_ms, @error, @replay_of)`,
      ).run(row);
      void opts;
    },

    async renewLease(messageId, workerId, leaseMs, now) {
      const info = db
        .prepare(
          "UPDATE messages SET lease_expires_at = @lease WHERE id = @id AND reserved_by = @worker",
        )
        .run({ lease: iso(new Date(now.getTime() + leaseMs)), id: messageId, worker: workerId });
      return info.changes > 0;
    },

    async releaseLease(messageId, workerId) {
      db.prepare(
        `UPDATE messages SET reserved_by = NULL, reserved_at = NULL, lease_expires_at = NULL
         WHERE id = @id AND reserved_by = @worker`,
      ).run({ id: messageId, worker: workerId });
    },

    async expireStaleLeases(now) {
      const info = db
        .prepare(
          `UPDATE messages SET reserved_by = NULL, reserved_at = NULL, lease_expires_at = NULL
           WHERE reserved_by IS NOT NULL AND (lease_expires_at IS NULL OR lease_expires_at <= @now)`,
        )
        .run({ now: iso(now) });
      return info.changes;
    },

    async markMessageFinal(messageId, status) {
      db.prepare(
        `UPDATE messages SET status = @status, reserved_by = NULL, reserved_at = NULL,
           lease_expires_at = NULL WHERE id = @id`,
      ).run({ status, id: messageId });
    },

    async rescheduleMessage(messageId, opts: RescheduleOpts<SqliteTx>) {
      const scheduledFor = iso(opts.scheduledFor);
      const info =
        opts.replayOf !== undefined
          ? db
              .prepare(
                `UPDATE messages SET scheduled_for = @s, reserved_by = NULL, reserved_at = NULL,
                   lease_expires_at = NULL, status = 'pending', replay_of = @r WHERE id = @id`,
              )
              .run({ s: scheduledFor, r: opts.replayOf, id: messageId })
          : db
              .prepare(
                `UPDATE messages SET scheduled_for = @s, reserved_by = NULL, reserved_at = NULL,
                   lease_expires_at = NULL, status = 'pending' WHERE id = @id`,
              )
              .run({ s: scheduledFor, id: messageId });
      return info.changes > 0;
    },

    async loadEndpointsForMessage(messageId) {
      const msg = db.prepare("SELECT tenant_id FROM messages WHERE id = ?").get(messageId) as
        | { tenant_id: string | null }
        | undefined;
      if (!msg) return [];
      const endpointRows = db
        .prepare("SELECT * FROM endpoints WHERE tenant_id IS ? ORDER BY created_at, id")
        .all(msg.tenant_id) as Record<string, unknown>[];
      const out: EndpointWithSecrets[] = [];
      for (const row of endpointRows) {
        const endpoint = attachCallbacks(decodeEndpoint(row, codec), registry);
        const secretRows = db
          .prepare("SELECT * FROM endpoint_secrets WHERE endpoint_id = ? ORDER BY priority")
          .all(endpoint.id) as Record<string, unknown>[];
        out.push({ endpoint, secrets: secretRows.map((s) => decodeSecret(s, codec)) });
      }
      return out;
    },

    async getMessage(id) {
      const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as
        | Record<string, unknown>
        | undefined;
      return row ? decodeStoredMessage(row, codec) : undefined;
    },

    async listMessages(filter: MessageListFilter) {
      const clauses: string[] = [];
      const values: unknown[] = [];
      if (filter.tenantId !== undefined) {
        clauses.push("tenant_id = ?");
        values.push(filter.tenantId);
      }
      if (filter.since !== undefined) {
        clauses.push("created_at >= ?");
        values.push(iso(filter.since));
      }
      if (filter.until !== undefined) {
        clauses.push("created_at <= ?");
        values.push(iso(filter.until));
      }
      if (filter.types !== undefined && filter.types.length > 0) {
        clauses.push(`type IN (${filter.types.map(() => "?").join(", ")})`);
        values.push(...filter.types);
      }
      if (filter.status !== undefined && filter.status.length > 0) {
        clauses.push(`status IN (${filter.status.map(() => "?").join(", ")})`);
        values.push(...filter.status);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      values.push(filter.limit ?? DEFAULT_MESSAGE_LIST_LIMIT);
      const rows = db
        .prepare(`SELECT * FROM messages ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
        .all(...values) as Record<string, unknown>[];
      return rows.map((row) => decodeStoredMessage(row, codec));
    },

    async *rangeQuery(filter: RangeQueryFilter) {
      const clauses: string[] = [];
      const params: { tenant?: string; since?: string; until?: string } = {};
      if (filter.tenantId !== undefined) {
        clauses.push("tenant_id = @tenant");
        params.tenant = filter.tenantId;
      }
      if (filter.since !== undefined) {
        clauses.push("created_at >= @since");
        params.since = iso(filter.since);
      }
      if (filter.until !== undefined) {
        clauses.push("created_at <= @until");
        params.until = iso(filter.until);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const iterator = db
        .prepare(`SELECT * FROM messages ${where} ORDER BY created_at, id`)
        .iterate(params) as IterableIterator<Record<string, unknown>>;
      for (const row of iterator) {
        const message = decodeReservedMessage(row, codec);
        if (filter.types !== undefined && !filter.types.includes(message.type)) continue;
        if (filter.predicate !== undefined && !filter.predicate(message)) continue;
        yield message;
      }
    },

    async *reconcile(filter: ReconcileFilter) {
      const clauses = ["created_at >= @since"];
      const params: { since: string; ep: string; tenant?: string } = {
        since: iso(filter.since),
        ep: filter.endpointId,
      };
      if (filter.tenantId !== undefined) {
        clauses.push("tenant_id = @tenant");
        params.tenant = filter.tenantId;
      }
      const iterator = db
        .prepare(
          `SELECT id, created_at FROM messages WHERE ${clauses.join(" AND ")} ORDER BY created_at, id`,
        )
        .iterate(params) as IterableIterator<{ id: string }>;
      const lastAttempt = db.prepare(
        `SELECT status FROM attempts WHERE message_id = @msg AND endpoint_id = @ep
         ORDER BY attempt_number DESC LIMIT 1`,
      );
      for (const row of iterator) {
        const last = lastAttempt.get({ msg: row.id, ep: filter.endpointId }) as
          | { status: string }
          | undefined;
        if (last === undefined || last.status !== "success") yield row.id as MessageId;
      }
    },

    async countPendingByTenant() {
      const rows = db
        .prepare(
          "SELECT tenant_id, COUNT(*) AS count FROM messages WHERE status = 'pending' GROUP BY tenant_id",
        )
        .all() as { tenant_id: string | null; count: number }[];
      const out = new Map<TenantId | "_null", number>();
      for (const row of rows) out.set(row.tenant_id ?? "_null", Number(row.count));
      return out;
    },

    async outboxDepth(opts) {
      const tenantClause = opts?.tenantId !== undefined ? "AND tenant_id = @tenant" : "";
      const row = db
        .prepare(
          `SELECT COUNT(*) AS depth, MIN(created_at) AS oldest FROM messages
           WHERE status = 'pending' ${tenantClause}`,
        )
        .get({ tenant: opts?.tenantId ?? null }) as { depth: number; oldest: string | null };
      const oldest = row.oldest === null ? undefined : new Date(row.oldest);
      return {
        depth: Number(row.depth),
        oldestPendingAge: oldest ? clock.now().getTime() - oldest.getTime() : undefined,
      };
    },

    attempts: {
      async countSince(endpointId, since): Promise<AttemptStatsResult> {
        const rows = db
          .prepare(
            `SELECT status FROM attempts
             WHERE endpoint_id = @ep
               AND COALESCE(completed_at, started_at, scheduled_for, @since) >= @since`,
          )
          .all({ ep: endpointId, since: iso(since) }) as { status: string }[];
        let failureCount = 0;
        for (const row of rows) if (FAILURE_STATUSES.has(row.status)) failureCount += 1;
        return { count: rows.length, failureCount };
      },
      async latestForMessage(messageId) {
        const rows = db
          .prepare("SELECT * FROM attempts WHERE message_id = ? ORDER BY attempt_number")
          .all(messageId) as Record<string, unknown>[];
        return rows.map((row) => decodeAttempt(row, codec));
      },
    },

    endpoints: {
      async create(rec, opts) {
        const now = clock.now();
        const full: EndpointRecord = {
          ...rec,
          filter: rec.filter ?? null,
          transform: rec.transform ?? null,
          createdAt: now,
          updatedAt: now,
        };
        const row = bindable(encodeEndpointInsert(full, codec));
        db.prepare(
          `INSERT INTO endpoints
             (id, tenant_id, url, state, types, channels, retry_policy, headers, signing, metadata,
              allow_http, max_inflight, http, circuit_breaker, auto_disable, created_at, updated_at)
           VALUES
             (@id, @tenant_id, @url, @state, @types, @channels, @retry_policy, @headers, @signing,
              @metadata, @allow_http, @max_inflight, @http, @circuit_breaker, @auto_disable,
              @created_at, @updated_at)`,
        ).run(row);
        registry.set(full.id, { filter: full.filter, transform: full.transform });
        void opts;
        return full;
      },
      async update(id, patch, opts) {
        return atomic(opts?.tx, () => {
          const prev = loadEndpointRecord(id);
          if (!prev) throw new Error(`endpoint not found: ${id}`);
          const next: EndpointRecord = { ...prev, ...patch, id: prev.id, updatedAt: clock.now() };
          const row = bindable(encodeEndpointInsert(next, codec));
          db.prepare(
            `UPDATE endpoints SET tenant_id = @tenant_id, url = @url, state = @state, types = @types,
               channels = @channels, retry_policy = @retry_policy, headers = @headers,
               signing = @signing, metadata = @metadata, allow_http = @allow_http,
               max_inflight = @max_inflight, http = @http, circuit_breaker = @circuit_breaker,
               auto_disable = @auto_disable, updated_at = @updated_at WHERE id = @id`,
          ).run(row);
          if ("filter" in patch || "transform" in patch) {
            registry.applyPatch(id, {
              ...("filter" in patch ? { filter: patch.filter ?? null } : {}),
              ...("transform" in patch ? { transform: patch.transform ?? null } : {}),
            });
          }
          return attachCallbacks(next, registry);
        });
      },
      async delete(id, opts) {
        atomic(opts?.tx, () => {
          db.prepare("DELETE FROM endpoint_secrets WHERE endpoint_id = ?").run(id);
          if (opts?.purgeAttempts === true) {
            db.prepare("DELETE FROM attempts WHERE endpoint_id = ?").run(id);
            db.prepare("DELETE FROM endpoint_state_transitions WHERE endpoint_id = ?").run(id);
          }
          db.prepare("DELETE FROM endpoints WHERE id = ?").run(id);
        });
        registry.delete(id);
      },
      async list(opts) {
        const where = opts?.tenantId !== undefined ? "WHERE tenant_id = @tenant" : "";
        const rows = db
          .prepare(`SELECT * FROM endpoints ${where} ORDER BY created_at, id`)
          .all({ tenant: opts?.tenantId ?? null }) as Record<string, unknown>[];
        return rows.map((row) => attachCallbacks(decodeEndpoint(row, codec), registry));
      },
      async get(id) {
        return loadEndpointRecord(id);
      },
      async transitionState(id, to, reason, actor, metadata, opts) {
        return atomic(opts?.tx, () => {
          const prev = db.prepare("SELECT state FROM endpoints WHERE id = ?").get(id) as
            | { state: EndpointState }
            | undefined;
          if (!prev) throw new Error(`endpoint not found: ${id}`);
          const transitionId = `trans_${cryptoId()}`;
          const occurredAt = clock.now();
          const transition: EndpointStateTransition = {
            id: transitionId,
            endpointId: id,
            fromState: prev.state,
            toState: to,
            reason,
            actor,
            metadata: metadata ?? null,
            occurredAt,
          };
          if (to !== null) {
            db.prepare(
              `INSERT INTO endpoint_state_transitions
                 (id, endpoint_id, from_state, to_state, reason, actor, metadata, occurred_at)
               VALUES (@id, @ep, @from, @to, @reason, @actor, @metadata, @at)`,
            ).run({
              id: transitionId,
              ep: id,
              from: prev.state,
              to,
              reason,
              actor,
              metadata: metadata === undefined ? null : JSON.stringify(metadata),
              at: iso(occurredAt),
            });
            db.prepare("UPDATE endpoints SET state = @state, updated_at = @at WHERE id = @id").run({
              state: to,
              at: iso(occurredAt),
              id,
            });
          }
          return transition;
        });
      },
      async listStateTransitions(id) {
        const rows = db
          .prepare(
            "SELECT * FROM endpoint_state_transitions WHERE endpoint_id = ? ORDER BY occurred_at, id",
          )
          .all(id) as Array<{
          id: string;
          endpoint_id: string;
          from_state: EndpointState | null;
          to_state: EndpointState | null;
          reason: string;
          actor: string | null;
          metadata: string | null;
          occurred_at: string;
        }>;
        return rows.map((row) => ({
          id: row.id,
          endpointId: row.endpoint_id,
          fromState: row.from_state ?? null,
          toState: row.to_state ?? null,
          reason: row.reason,
          actor: row.actor ?? null,
          metadata:
            row.metadata === null ? null : (JSON.parse(row.metadata) as Record<string, unknown>),
          occurredAt: new Date(row.occurred_at),
        }));
      },
    },

    secrets: {
      async insert(rec, opts) {
        const full: EndpointSecretRecord = { ...rec, createdAt: clock.now() };
        const row = bindable({
          ...encodeSecretInsert(rec, codec),
          created_at: iso(full.createdAt),
        });
        db.prepare(
          `INSERT INTO endpoint_secrets
             (id, endpoint_id, algorithm, status, priority, encrypted_value, public_key,
              not_after, created_at)
           VALUES
             (@id, @endpoint_id, @algorithm, @status, @priority, @encrypted_value, @public_key,
              @not_after, @created_at)`,
        ).run(row);
        void opts;
        return full;
      },
      async listForEndpoint(endpointId) {
        const rows = db
          .prepare("SELECT * FROM endpoint_secrets WHERE endpoint_id = ? ORDER BY priority")
          .all(endpointId) as Record<string, unknown>[];
        return rows.map((row) => decodeSecret(row, codec));
      },
      async setStatus(secretId, status, notAfter, opts) {
        db.prepare(
          "UPDATE endpoint_secrets SET status = @status, not_after = @notAfter WHERE id = @id",
        ).run({ status, notAfter: notAfter === null ? null : iso(notAfter), id: secretId });
        void opts;
      },
      async deleteExpired(now) {
        const info = db
          .prepare("DELETE FROM endpoint_secrets WHERE not_after IS NOT NULL AND not_after <= ?")
          .run(iso(now));
        return info.changes;
      },
    },

    tenants: {
      async upsert(tenantId, metadata, opts) {
        return atomic(opts?.tx, () => {
          const existing = db
            .prepare("SELECT created_at FROM tenants WHERE id = ?")
            .get(tenantId) as { created_at: string } | undefined;
          const createdAt = existing ? new Date(existing.created_at) : clock.now();
          db.prepare(
            `INSERT INTO tenants (id, metadata, created_at) VALUES (@id, @metadata, @created_at)
             ON CONFLICT (id) DO UPDATE SET metadata = @metadata`,
          ).run({
            id: tenantId,
            metadata: metadata === null ? null : JSON.stringify(metadata),
            created_at: iso(createdAt),
          });
          const rec: TenantRecord = { id: tenantId, metadata, createdAt };
          return rec;
        });
      },
      async get(tenantId) {
        const row = db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId) as
          | { id: string; metadata: string | null; created_at: string }
          | undefined;
        if (!row) return undefined;
        return {
          id: row.id,
          metadata:
            row.metadata === null ? null : (JSON.parse(row.metadata) as Record<string, unknown>),
          createdAt: new Date(row.created_at),
        };
      },
      async delete(tenantId, opts) {
        atomic(opts?.tx, () => {
          const endpointRows = db
            .prepare("SELECT id FROM endpoints WHERE tenant_id = ?")
            .all(tenantId) as { id: string }[];
          for (const { id } of endpointRows) {
            db.prepare("DELETE FROM endpoint_secrets WHERE endpoint_id = ?").run(id);
            db.prepare("DELETE FROM endpoint_state_transitions WHERE endpoint_id = ?").run(id);
          }
          db.prepare("DELETE FROM attempts WHERE tenant_id = ?").run(tenantId);
          db.prepare("DELETE FROM messages WHERE tenant_id = ?").run(tenantId);
          db.prepare("DELETE FROM endpoints WHERE tenant_id = ?").run(tenantId);
          db.prepare("DELETE FROM tenants WHERE id = ?").run(tenantId);
          for (const { id } of endpointRows) registry.delete(id);
        });
      },
    },

    async dedup(messageId, opts) {
      const nowMs = clock.now().getTime();
      const run = (): { duplicate: boolean } => {
        db.prepare("DELETE FROM postel_received_messages WHERE expires_at <= ?").run(nowMs);
        const info = db
          .prepare(
            "INSERT OR IGNORE INTO postel_received_messages (message_id, expires_at) VALUES (?, ?)",
          )
          .run(messageId, nowMs + opts.ttlSeconds * 1000);
        return { duplicate: info.changes === 0 };
      };
      return run();
    },

    async transaction<R>(cb: (tx: SqliteTx) => Promise<R>): Promise<R> {
      db.prepare("BEGIN").run();
      const tx: SqliteTx = { active: true };
      try {
        const result = await cb(tx);
        tx.active = false;
        db.prepare("COMMIT").run();
        return result;
      } catch (err) {
        tx.active = false;
        db.prepare("ROLLBACK").run();
        throw err;
      }
    },
  };
}

function cryptoId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
