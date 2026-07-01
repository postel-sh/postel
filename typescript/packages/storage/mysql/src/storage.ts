import { createRequire } from "node:module";
import type {
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
  MYSQL_CAPABILITIES,
  MYSQL_CODEC,
  MYSQL_MIGRATIONS,
  attachCallbacks,
  createCallbackRegistry,
  decodeAttempt,
  decodeEndpoint,
  decodeJson,
  decodeReservedMessage,
  decodeSecret,
  decodeStoredMessage,
  encodeAttemptInsert,
  encodeEndpointInsert,
  encodeMessageInsert,
  encodeSecretInsert,
  encodeTimestamp,
} from "@postel/storage-helpers";
import type { Pool } from "mysql2/promise";

// MySQL stores timestamps as BIGINT epoch-ms and JSON as native JSON columns.
const codec = MYSQL_CODEC;

// Minimal slice of mysql2's promise `Pool` / `PoolConnection` the adapter calls.
// A real `mysql2.Pool` satisfies it structurally; the adapter narrows to this.
export interface MysqlQueryable {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
}
export interface MysqlPoolConnection extends MysqlQueryable {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}
export interface MysqlPool extends MysqlQueryable {
  getConnection(): Promise<MysqlPoolConnection>;
}

export interface MysqlStorageOptions {
  // An existing mysql2 `Pool` — or a connectionString for Postel to open its own.
  readonly pool?: Pool;
  readonly connectionString?: string;
  readonly clock?: Clock;
  readonly autoMigrate?: boolean;
}

type Row = Record<string, unknown>;

function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value);
  return value;
}

function statements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildInsert(table: string, row: Row): [string, unknown[]] {
  const cols = Object.keys(row);
  const idents = cols.map((c) => `\`${c}\``).join(", ");
  const placeholders = cols.map(() => "?").join(", ");
  return [
    `INSERT INTO \`${table}\` (${idents}) VALUES (${placeholders})`,
    cols.map((c) => normalize(row[c])),
  ];
}

function affectedRows(result: unknown): number {
  return (result as { affectedRows?: number }).affectedRows ?? 0;
}

const FAILURE_STATUSES = new Set([
  "failed",
  "failed-permanent",
  "dead-letter",
  "ssrf-blocked",
  "expired",
]);

export function MysqlStorage(options: MysqlStorageOptions = {}): Storage<MysqlQueryable> {
  if (!options.pool && !options.connectionString) {
    throw new Error("MysqlStorage requires either a `pool` or a `connectionString`");
  }
  let ownedPool: MysqlPool | undefined;
  function pool(): MysqlPool {
    if (options.pool) return options.pool as unknown as MysqlPool;
    if (!ownedPool) {
      const require_ = createRequire(import.meta.url);
      const mysql = require_("mysql2/promise") as {
        createPool(config: string): MysqlPool;
      };
      ownedPool = mysql.createPool(options.connectionString as string);
    }
    return ownedPool;
  }

  const clock: Clock = options.clock ?? { now: () => new Date(), sleep: async () => {} };
  const registry = createCallbackRegistry();
  let migrated = false;

  async function rows<R = Row>(on: MysqlQueryable, sql: string, values?: unknown[]): Promise<R[]> {
    const [result] = await on.query(sql, values);
    return result as R[];
  }

  async function run(on: MysqlQueryable, sql: string, values?: unknown[]): Promise<number> {
    const [result] = await on.query(sql, values);
    return affectedRows(result);
  }

  async function insert(on: MysqlQueryable, table: string, row: Row): Promise<void> {
    const [text, values] = buildInsert(table, row);
    await on.query(text, values);
  }

  async function migrate(): Promise<void> {
    const p = pool();
    let current = 0;
    try {
      const res = await rows<{ value: string }>(
        p,
        "SELECT value FROM _postel_meta WHERE `key` = 'schema_version'",
      );
      if (res[0]?.value !== undefined) current = Number(res[0].value);
    } catch {
      current = 0;
    }
    for (const m of MYSQL_MIGRATIONS) {
      if (m.version <= current) continue;
      // mysql2 disallows multiple statements per query by default, so each
      // statement runs on its own (matches the ORM adapters' migrate path).
      for (const stmt of statements(m.sql)) await p.query(stmt);
    }
    await p.query(
      `CREATE TABLE IF NOT EXISTS postel_received_messages (
         message_id VARCHAR(191) PRIMARY KEY,
         expires_at BIGINT NOT NULL,
         INDEX postel_received_messages_expires_idx (expires_at)
       )`,
    );
    migrated = true;
  }

  async function ready(): Promise<void> {
    if (options.autoMigrate === false || migrated) return;
    await migrate();
  }

  function exec(opts?: HostTxOption<MysqlQueryable>): MysqlQueryable {
    return opts?.tx ?? pool();
  }

  // Run fn against the host tx if present, else in a dedicated connection's
  // BEGIN/COMMIT (a single connection — mysql2 transactions are connection-bound).
  async function atomic<R>(
    tx: MysqlQueryable | undefined,
    fn: (q: MysqlQueryable) => Promise<R>,
  ): Promise<R> {
    if (tx) return fn(tx);
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async function loadEndpointRecord(
    q: MysqlQueryable,
    id: EndpointId,
  ): Promise<EndpointRecord | undefined> {
    const res = await rows(q, "SELECT * FROM endpoints WHERE id = ?", [id]);
    const row = res[0];
    if (!row) return undefined;
    return attachCallbacks(decodeEndpoint(row, codec), registry);
  }

  return {
    capabilities: MYSQL_CAPABILITIES,

    async schemaVersion() {
      await ready();
      const res = await rows<{ value: string }>(
        pool(),
        "SELECT value FROM _postel_meta WHERE `key` = 'schema_version'",
      );
      return res[0]?.value === undefined ? 0 : Number(res[0].value);
    },

    async insertMessage(msg: NewMessage, opts?: HostTxOption<MysqlQueryable>) {
      await ready();
      await insert(exec(opts), "messages", encodeMessageInsert(msg, codec));
      return msg.id;
    },

    async insertOrReuseByIdempotencyKey(
      msg: NewMessage,
      opts?: HostTxOption<MysqlQueryable>,
    ): Promise<InsertOrReuseResult> {
      await ready();
      if (msg.idempotencyKey === null) {
        const id = await this.insertMessage(msg, opts);
        return { id, reused: false };
      }
      return atomic(opts?.tx, async (q) => {
        // `<=>` is MySQL's null-safe equality (matches PG's IS NOT DISTINCT FROM).
        const existing = await rows<{ id: string }>(
          q,
          "SELECT id FROM messages WHERE tenant_id <=> ? AND idempotency_key = ? LIMIT 1",
          [msg.tenantId, msg.idempotencyKey],
        );
        if (existing[0]?.id !== undefined) return { id: existing[0].id, reused: true };
        await insert(q, "messages", encodeMessageInsert(msg, codec));
        return { id: msg.id, reused: false };
      });
    },

    async reserveBatch(opts: ReserveBatchOpts): Promise<ReadonlyArray<ReservedMessage>> {
      await ready();
      const now = opts.now.getTime();
      const leaseExpiresAt = opts.now.getTime() + opts.leaseMs;
      const conn = await pool().getConnection();
      try {
        // READ COMMITTED so FOR UPDATE SKIP LOCKED takes only record locks: the
        // default REPEATABLE READ gap-locks the scanned range, which makes a
        // concurrent worker skip past unlocked rows and under-reserve.
        await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
        await conn.beginTransaction();
        // No RETURNING in MySQL: lock the due rows with SKIP LOCKED, stamp them,
        // then read them back — all inside one transaction so the lock holds.
        const selected = await rows<{ id: string }>(
          conn,
          `SELECT id FROM messages
             WHERE status = 'pending' AND reserved_by IS NULL
               AND (? IS NULL OR tenant_id = ?)
               AND (scheduled_for IS NULL OR scheduled_for <= ?)
             ORDER BY created_at, id
             LIMIT ?
             FOR UPDATE SKIP LOCKED`,
          [opts.tenantId ?? null, opts.tenantId ?? null, now, opts.batchSize],
        );
        if (selected.length === 0) {
          await conn.commit();
          return [];
        }
        const ids = selected.map((r) => r.id);
        const placeholders = ids.map(() => "?").join(", ");
        await conn.query(
          `UPDATE messages
             SET reserved_by = ?, reserved_at = ?, lease_expires_at = ?,
                 attempt_number = attempt_number + 1
           WHERE id IN (${placeholders})`,
          [opts.workerId, now, leaseExpiresAt, ...ids],
        );
        const reserved = await rows(
          conn,
          `SELECT * FROM messages WHERE id IN (${placeholders})
           ORDER BY created_at, id`,
          ids,
        );
        await conn.commit();
        return reserved.map((row) => decodeReservedMessage(row, codec));
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    },

    async recordAttempt(attempt: NewAttempt, opts?: HostTxOption<MysqlQueryable>) {
      await ready();
      await insert(exec(opts), "attempts", encodeAttemptInsert(attempt, codec));
    },

    async renewLease(messageId, workerId, leaseMs, now) {
      const affected = await run(
        pool(),
        "UPDATE messages SET lease_expires_at = ? WHERE id = ? AND reserved_by = ?",
        [now.getTime() + leaseMs, messageId, workerId],
      );
      return affected > 0;
    },

    async releaseLease(messageId, workerId) {
      await run(
        pool(),
        `UPDATE messages SET reserved_by = NULL, reserved_at = NULL, lease_expires_at = NULL
         WHERE id = ? AND reserved_by = ?`,
        [messageId, workerId],
      );
    },

    async expireStaleLeases(now) {
      return run(
        pool(),
        `UPDATE messages SET reserved_by = NULL, reserved_at = NULL, lease_expires_at = NULL
         WHERE reserved_by IS NOT NULL AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
        [now.getTime()],
      );
    },

    async markMessageFinal(messageId, status) {
      await run(
        pool(),
        `UPDATE messages SET status = ?, reserved_by = NULL, reserved_at = NULL,
           lease_expires_at = NULL WHERE id = ?`,
        [status, messageId],
      );
    },

    async rescheduleMessage(messageId, opts: RescheduleOpts<MysqlQueryable>) {
      const q = exec(opts);
      const scheduledFor = opts.scheduledFor.getTime();
      const affected =
        opts.replayOf !== undefined
          ? await run(
              q,
              `UPDATE messages SET scheduled_for = ?, reserved_by = NULL, reserved_at = NULL,
                 lease_expires_at = NULL, status = 'pending', replay_of = ? WHERE id = ?`,
              [scheduledFor, opts.replayOf, messageId],
            )
          : await run(
              q,
              `UPDATE messages SET scheduled_for = ?, reserved_by = NULL, reserved_at = NULL,
                 lease_expires_at = NULL, status = 'pending' WHERE id = ?`,
              [scheduledFor, messageId],
            );
      return affected > 0;
    },

    async loadEndpointsForMessage(messageId) {
      await ready();
      const msg = await rows<{ tenant_id: string | null }>(
        pool(),
        "SELECT tenant_id FROM messages WHERE id = ?",
        [messageId],
      );
      if (msg.length === 0) return [];
      const tenantId = msg[0]?.tenant_id ?? null;
      const endpointRows = await rows(
        pool(),
        "SELECT * FROM endpoints WHERE tenant_id <=> ? ORDER BY created_at, id",
        [tenantId],
      );
      const out: EndpointWithSecrets[] = [];
      for (const row of endpointRows) {
        const endpoint = attachCallbacks(decodeEndpoint(row, codec), registry);
        const secretRows = await rows(
          pool(),
          "SELECT * FROM endpoint_secrets WHERE endpoint_id = ? ORDER BY priority",
          [endpoint.id],
        );
        out.push({ endpoint, secrets: secretRows.map((s) => decodeSecret(s, codec)) });
      }
      return out;
    },

    async getMessage(id, opts) {
      await ready();
      const res = await rows(exec(opts), "SELECT * FROM messages WHERE id = ?", [id]);
      const row = res[0];
      return row ? decodeStoredMessage(row, codec) : undefined;
    },

    async listMessages(filter: MessageListFilter) {
      await ready();
      const clauses: string[] = [];
      const values: unknown[] = [];
      if (filter.tenantId !== undefined) {
        values.push(filter.tenantId);
        clauses.push("tenant_id = ?");
      }
      if (filter.since !== undefined) {
        values.push(filter.since.getTime());
        clauses.push("created_at >= ?");
      }
      if (filter.until !== undefined) {
        values.push(filter.until.getTime());
        clauses.push("created_at <= ?");
      }
      if (filter.types !== undefined && filter.types.length > 0) {
        values.push(filter.types);
        clauses.push("type IN (?)");
      }
      if (filter.status !== undefined && filter.status.length > 0) {
        values.push(filter.status);
        clauses.push("status IN (?)");
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      values.push(filter.limit ?? DEFAULT_MESSAGE_LIST_LIMIT);
      const res = await rows(
        pool(),
        `SELECT * FROM messages ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
        values,
      );
      return res.map((row) => decodeStoredMessage(row, codec));
    },

    async *rangeQuery(filter: RangeQueryFilter) {
      await ready();
      const clauses: string[] = [];
      const values: unknown[] = [];
      if (filter.tenantId !== undefined) {
        values.push(filter.tenantId);
        clauses.push("tenant_id = ?");
      }
      if (filter.since !== undefined) {
        values.push(filter.since.getTime());
        clauses.push("created_at >= ?");
      }
      if (filter.until !== undefined) {
        values.push(filter.until.getTime());
        clauses.push("created_at <= ?");
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const res = await rows(
        pool(),
        `SELECT * FROM messages ${where} ORDER BY created_at, id`,
        values,
      );
      for (const row of res) {
        const message = decodeReservedMessage(row, codec);
        if (filter.types !== undefined && !filter.types.includes(message.type)) continue;
        if (filter.predicate !== undefined && !filter.predicate(message)) continue;
        yield message;
      }
    },

    async *reconcile(filter: ReconcileFilter) {
      await ready();
      const values: unknown[] = [filter.since.getTime()];
      let where = "created_at >= ?";
      if (filter.tenantId !== undefined) {
        values.push(filter.tenantId);
        where += " AND tenant_id = ?";
      }
      const res = await rows<{ id: string }>(
        pool(),
        `SELECT id, created_at FROM messages WHERE ${where} ORDER BY created_at, id`,
        values,
      );
      for (const row of res) {
        const last = await rows<{ status: string }>(
          pool(),
          `SELECT status FROM attempts WHERE message_id = ? AND endpoint_id = ?
           ORDER BY attempt_number DESC LIMIT 1`,
          [row.id, filter.endpointId],
        );
        if (last.length === 0 || last[0]?.status !== "success") yield row.id as MessageId;
      }
    },

    async countPendingByTenant() {
      await ready();
      const res = await rows<{ tenant_id: string | null; count: number | string }>(
        pool(),
        "SELECT tenant_id, COUNT(*) AS count FROM messages WHERE status = 'pending' GROUP BY tenant_id",
      );
      const out = new Map<TenantId | "_null", number>();
      for (const row of res) out.set(row.tenant_id ?? "_null", Number(row.count));
      return out;
    },

    async outboxDepth(opts) {
      await ready();
      const tenantClause = opts?.tenantId !== undefined ? "AND tenant_id = ?" : "";
      const res = await rows<{ depth: number | string; oldest: number | string | null }>(
        pool(),
        `SELECT COUNT(*) AS depth, MIN(created_at) AS oldest FROM messages
         WHERE status = 'pending' ${tenantClause}`,
        opts?.tenantId !== undefined ? [opts.tenantId] : [],
      );
      const row = res[0];
      const oldest = row?.oldest ?? null;
      return {
        depth: Number(row?.depth ?? 0),
        oldestPendingAge: oldest !== null ? clock.now().getTime() - Number(oldest) : undefined,
      };
    },

    attempts: {
      async countSince(endpointId, since) {
        const res = await rows<{ status: string }>(
          pool(),
          `SELECT status FROM attempts
           WHERE endpoint_id = ?
             AND COALESCE(completed_at, started_at, scheduled_for, ?) >= ?`,
          [endpointId, since.getTime(), since.getTime()],
        );
        let failureCount = 0;
        for (const row of res) if (FAILURE_STATUSES.has(row.status)) failureCount += 1;
        return { count: res.length, failureCount };
      },
      async latestForMessage(messageId) {
        const res = await rows(
          pool(),
          "SELECT * FROM attempts WHERE message_id = ? ORDER BY attempt_number",
          [messageId],
        );
        return res.map((row) => decodeAttempt(row, codec));
      },
    },

    endpoints: {
      async create(rec, opts) {
        await ready();
        const now = clock.now();
        const full: EndpointRecord = {
          ...rec,
          filter: rec.filter ?? null,
          transform: rec.transform ?? null,
          createdAt: now,
          updatedAt: now,
        };
        await insert(exec(opts), "endpoints", encodeEndpointInsert(full, codec));
        registry.set(full.id, { filter: full.filter, transform: full.transform });
        return full;
      },
      async update(id, patch, opts) {
        return atomic(opts?.tx, async (q) => {
          const prev = await loadEndpointRecord(q, id);
          if (!prev) throw new Error(`endpoint not found: ${id}`);
          const next: EndpointRecord = { ...prev, ...patch, id: prev.id, updatedAt: clock.now() };
          const row = encodeEndpointInsert(next, codec);
          const cols = Object.keys(row).filter((c) => c !== "id" && c !== "created_at");
          const assignments = cols.map((c) => `\`${c}\` = ?`).join(", ");
          await q.query(`UPDATE endpoints SET ${assignments} WHERE id = ?`, [
            ...cols.map((c) => normalize(row[c])),
            id,
          ]);
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
        await atomic(opts?.tx, async (q) => {
          await q.query("DELETE FROM endpoint_secrets WHERE endpoint_id = ?", [id]);
          if (opts?.purgeAttempts === true) {
            await q.query("DELETE FROM attempts WHERE endpoint_id = ?", [id]);
            await q.query("DELETE FROM endpoint_state_transitions WHERE endpoint_id = ?", [id]);
          }
          await q.query("DELETE FROM endpoints WHERE id = ?", [id]);
        });
        registry.delete(id);
      },
      async list(opts) {
        await ready();
        const res =
          opts?.tenantId !== undefined
            ? await rows(
                pool(),
                "SELECT * FROM endpoints WHERE tenant_id = ? ORDER BY created_at, id",
                [opts.tenantId],
              )
            : await rows(pool(), "SELECT * FROM endpoints ORDER BY created_at, id");
        return res.map((row) => attachCallbacks(decodeEndpoint(row, codec), registry));
      },
      async get(id) {
        await ready();
        return loadEndpointRecord(pool(), id);
      },
      async transitionState(id, to, reason, actor, metadata, opts) {
        return atomic(opts?.tx, async (q) => {
          const prevRes = await rows<{ state: EndpointState }>(
            q,
            "SELECT state FROM endpoints WHERE id = ?",
            [id],
          );
          const prev = prevRes[0];
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
            await insert(q, "endpoint_state_transitions", {
              id: transitionId,
              endpoint_id: id,
              from_state: prev.state,
              to_state: to,
              reason,
              actor,
              metadata: metadata === undefined ? null : JSON.stringify(metadata),
              occurred_at: encodeTimestamp(occurredAt, codec),
            });
            await q.query("UPDATE endpoints SET state = ?, updated_at = ? WHERE id = ?", [
              to,
              encodeTimestamp(occurredAt, codec),
              id,
            ]);
          }
          return transition;
        });
      },
      async listStateTransitions(id) {
        const res = await rows<{
          id: string;
          endpoint_id: string;
          from_state: EndpointState | null;
          to_state: EndpointState | null;
          reason: string;
          actor: string | null;
          metadata: unknown;
          occurred_at: number | string;
        }>(
          pool(),
          "SELECT * FROM endpoint_state_transitions WHERE endpoint_id = ? ORDER BY occurred_at, id",
          [id],
        );
        return res.map((row) => ({
          id: row.id,
          endpointId: row.endpoint_id,
          fromState: row.from_state ?? null,
          toState: row.to_state ?? null,
          reason: row.reason,
          actor: row.actor ?? null,
          metadata: decodeJson<Record<string, unknown>>(row.metadata, codec),
          occurredAt: new Date(Number(row.occurred_at)),
        }));
      },
    },

    secrets: {
      async insert(rec, opts) {
        await ready();
        const full: EndpointSecretRecord = { ...rec, createdAt: clock.now() };
        await insert(exec(opts), "endpoint_secrets", {
          ...encodeSecretInsert(rec, codec),
          created_at: encodeTimestamp(full.createdAt, codec),
        });
        return full;
      },
      async listForEndpoint(endpointId) {
        const res = await rows(
          pool(),
          "SELECT * FROM endpoint_secrets WHERE endpoint_id = ? ORDER BY priority",
          [endpointId],
        );
        return res.map((row) => decodeSecret(row, codec));
      },
      async setStatus(secretId, status, notAfter, opts) {
        await run(
          exec(opts),
          "UPDATE endpoint_secrets SET status = ?, not_after = ? WHERE id = ?",
          [status, notAfter === null ? null : notAfter.getTime(), secretId],
        );
      },
      async deleteExpired(now) {
        return run(
          pool(),
          "DELETE FROM endpoint_secrets WHERE not_after IS NOT NULL AND not_after <= ?",
          [now.getTime()],
        );
      },
    },

    tenants: {
      async upsert(tenantId, metadata, opts) {
        await ready();
        return atomic(opts?.tx, async (q) => {
          const existing = await rows<{ created_at: number | string }>(
            q,
            "SELECT created_at FROM tenants WHERE id = ?",
            [tenantId],
          );
          const createdAt = existing[0] ? new Date(Number(existing[0].created_at)) : clock.now();
          await q.query(
            `INSERT INTO tenants (id, metadata, created_at) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE metadata = VALUES(metadata)`,
            [tenantId, metadata === null ? null : JSON.stringify(metadata), createdAt.getTime()],
          );
          const rec: TenantRecord = { id: tenantId, metadata, createdAt };
          return rec;
        });
      },
      async get(tenantId) {
        const res = await rows<{ id: string; metadata: unknown; created_at: number | string }>(
          pool(),
          "SELECT * FROM tenants WHERE id = ?",
          [tenantId],
        );
        const row = res[0];
        if (!row) return undefined;
        return {
          id: row.id,
          metadata: decodeJson<Record<string, unknown>>(row.metadata, codec),
          createdAt: new Date(Number(row.created_at)),
        };
      },
      async delete(tenantId, opts) {
        await atomic(opts?.tx, async (q) => {
          const endpointRows = await rows<{ id: string }>(
            q,
            "SELECT id FROM endpoints WHERE tenant_id = ?",
            [tenantId],
          );
          await q.query(
            "DELETE FROM endpoint_secrets WHERE endpoint_id IN (SELECT id FROM endpoints WHERE tenant_id = ?)",
            [tenantId],
          );
          await q.query(
            "DELETE FROM endpoint_state_transitions WHERE endpoint_id IN (SELECT id FROM endpoints WHERE tenant_id = ?)",
            [tenantId],
          );
          await q.query("DELETE FROM attempts WHERE tenant_id = ?", [tenantId]);
          await q.query("DELETE FROM messages WHERE tenant_id = ?", [tenantId]);
          await q.query("DELETE FROM endpoints WHERE tenant_id = ?", [tenantId]);
          await q.query("DELETE FROM tenants WHERE id = ?", [tenantId]);
          for (const row of endpointRows) registry.delete(row.id);
        });
      },
    },

    async dedup(messageId, opts) {
      await ready();
      const q = exec(opts);
      const nowMs = clock.now().getTime();
      const expires = nowMs + opts.ttlSeconds * 1000;
      // INSERT IGNORE gives a clean affectedRows (1 inserted / 0 duplicate) —
      // unlike ON DUPLICATE KEY UPDATE, whose no-op IF branch still reports a
      // changed row, so it can't tell a live duplicate from an expired refresh.
      const inserted = await run(
        q,
        "INSERT IGNORE INTO postel_received_messages (message_id, expires_at) VALUES (?, ?)",
        [messageId, expires],
      );
      if (inserted > 0) return { duplicate: false };
      // Row exists: refresh it only if expired (the WHERE makes a live row a
      // no-match → 0 affected → duplicate).
      const refreshed = await run(
        q,
        "UPDATE postel_received_messages SET expires_at = ? WHERE message_id = ? AND expires_at <= ?",
        [expires, messageId, nowMs],
      );
      return { duplicate: refreshed === 0 };
    },

    async transaction<R>(cb: (tx: MysqlQueryable) => Promise<R>): Promise<R> {
      await ready();
      const conn = await pool().getConnection();
      try {
        await conn.beginTransaction();
        const result = await cb(conn);
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
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
