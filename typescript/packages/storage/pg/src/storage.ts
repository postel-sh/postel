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
  TenantListFilter,
  TenantRecord,
} from "@postel/core";
import {
  type ColumnCodec,
  DEFAULT_MESSAGE_LIST_LIMIT,
  DEFAULT_TENANT_LIST_LIMIT,
  PG_CAPABILITIES,
  PG_MIGRATIONS,
  attachCallbacks,
  createCallbackRegistry,
  decodeAttempt,
  decodeEndpoint,
  decodeReservedMessage,
  decodeSecret,
  decodeStoredMessage,
  decodeTenant,
  decodeTenantCursor,
  encodeAttemptInsert,
  encodeEndpointInsert,
  encodeMessageInsert,
  encodeSecretInsert,
  encodeTenantCursor,
} from "@postel/storage-helpers";
import type { Pool } from "pg";

// node-postgres returns native Date for timestamptz and parsed JS for jsonb, but
// binds arrays as PG arrays — so encode JSON as text (Postgres parses it into
// jsonb from column context) and decode passes pg's already-parsed values
// through. Timestamps stay native (Date in, Date out).
const codec: ColumnCodec = { time: "native", json: "text" };
const NEW_MESSAGE_CHANNEL = "postel_messages_new";

// Minimal subset of node-postgres's Pool / PoolClient the adapter needs. A real
// `pg.Pool` satisfies it; tests can pass a pglite-backed shim.
export interface PgQueryResult<R = Record<string, unknown>> {
  rows: R[];
  rowCount: number | null;
}
export interface PgQueryable {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PgQueryResult<R>>;
}
export interface PgPoolClient extends PgQueryable {
  release(): void;
  on(event: "notification", listener: (msg: { channel: string; payload?: string }) => void): void;
}
export interface PgPool extends PgQueryable {
  connect(): Promise<PgPoolClient>;
}

export interface PgStorageOptions {
  // An existing node-postgres `Pool` — or a connectionString for Postel to open
  // its own pool.
  readonly pool?: Pool;
  readonly connectionString?: string;
  readonly clock?: Clock;
  readonly autoMigrate?: boolean;
}

function iso(date: Date): Date {
  return date;
}

function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value);
  return value;
}

function buildInsert(table: string, row: Record<string, unknown>): [string, unknown[]] {
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  return [
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`,
    cols.map((c) => normalize(row[c])),
  ];
}

const FAILURE_STATUSES = new Set([
  "failed",
  "failed-permanent",
  "dead-letter",
  "ssrf-blocked",
  "expired",
]);

export function PgStorage(options: PgStorageOptions = {}): Storage<PgQueryable> {
  if (!options.pool && !options.connectionString) {
    throw new Error("PgStorage requires either a `pool` or a `connectionString`");
  }
  // Lazily construct a pool from a connection string only when no pool was
  // handed in (keeps `pg` out of the import graph for shim-backed tests).
  let ownedPool: PgPool | undefined;
  function pool(): PgPool {
    // A real node-postgres `Pool` is structurally close but its `client.on`
    // overloads are wider than the slice we use (only `notification`); the
    // adapter calls just `query` / `connect` / `on("notification")`, so the
    // internal shim is the safe runtime contract.
    if (options.pool) return options.pool as unknown as PgPool;
    if (!ownedPool) {
      const require_ = createRequire(import.meta.url);
      const pg = require_("pg") as {
        Pool: new (config: { connectionString?: string | undefined }) => PgPool;
      };
      ownedPool = new pg.Pool({ connectionString: options.connectionString });
    }
    return ownedPool;
  }

  const clock: Clock = options.clock ?? { now: () => new Date(), sleep: async () => {} };
  const registry = createCallbackRegistry();
  let migrated = false;

  async function migrate(): Promise<void> {
    const p = pool();
    let current = 0;
    try {
      const res = await p.query<{ value: string }>(
        "SELECT value FROM _postel_meta WHERE key = 'schema_version'",
      );
      if (res.rows[0]?.value !== undefined) current = Number(res.rows[0].value);
    } catch {
      current = 0;
    }
    for (const m of PG_MIGRATIONS) {
      if (m.version > current) await p.query(m.sql);
    }
    await p.query(
      `CREATE TABLE IF NOT EXISTS postel_received_messages (
         message_id text PRIMARY KEY,
         expires_at timestamptz NOT NULL
       )`,
    );
    migrated = true;
  }

  async function ready(): Promise<void> {
    if (options.autoMigrate === false || migrated) return;
    await migrate();
  }

  function exec(opts?: HostTxOption<PgQueryable>): PgQueryable {
    return opts?.tx ?? pool();
  }

  // Run fn against the host tx if present, else in a dedicated BEGIN/COMMIT.
  async function atomic<R>(
    tx: PgQueryable | undefined,
    fn: (q: PgQueryable) => Promise<R>,
  ): Promise<R> {
    if (tx) return fn(tx);
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async function loadEndpointRecord(
    q: PgQueryable,
    id: EndpointId,
  ): Promise<EndpointRecord | undefined> {
    const res = await q.query("SELECT * FROM endpoints WHERE id = $1", [id]);
    const row = res.rows[0];
    if (!row) return undefined;
    return attachCallbacks(decodeEndpoint(row, codec), registry);
  }

  return {
    capabilities: PG_CAPABILITIES,

    async schemaVersion() {
      await ready();
      const res = await pool().query<{ value: string }>(
        "SELECT value FROM _postel_meta WHERE key = 'schema_version'",
      );
      return res.rows[0]?.value === undefined ? 0 : Number(res.rows[0].value);
    },

    async insertMessage(msg: NewMessage, opts?: HostTxOption<PgQueryable>) {
      await ready();
      const [text, values] = buildInsert("messages", encodeMessageInsert(msg, codec));
      await exec(opts).query(text, values);
      if (!opts?.tx) await pool().query("SELECT pg_notify($1, $2)", [NEW_MESSAGE_CHANNEL, msg.id]);
      return msg.id;
    },

    async insertOrReuseByIdempotencyKey(
      msg: NewMessage,
      opts?: HostTxOption<PgQueryable>,
    ): Promise<InsertOrReuseResult> {
      await ready();
      if (msg.idempotencyKey === null) {
        const id = await this.insertMessage(msg, opts);
        return { id, reused: false };
      }
      return atomic(opts?.tx, async (q) => {
        const existing = await q.query<{ id: string }>(
          "SELECT id FROM messages WHERE tenant_id IS NOT DISTINCT FROM $1 AND idempotency_key = $2 LIMIT 1",
          [msg.tenantId, msg.idempotencyKey],
        );
        if (existing.rows[0]?.id !== undefined) return { id: existing.rows[0].id, reused: true };
        const [text, values] = buildInsert("messages", encodeMessageInsert(msg, codec));
        await q.query(text, values);
        return { id: msg.id, reused: false };
      });
    },

    async reserveBatch(opts: ReserveBatchOpts): Promise<ReadonlyArray<ReservedMessage>> {
      await ready();
      const leaseExpiresAt = new Date(opts.now.getTime() + opts.leaseMs);
      const res = await pool().query(
        `UPDATE messages
           SET reserved_by = $1, reserved_at = $2, lease_expires_at = $3,
               attempt_number = attempt_number + 1
         WHERE id IN (
           SELECT id FROM messages
           WHERE status = 'pending' AND reserved_by IS NULL
             AND ($4::text IS NULL OR tenant_id = $4)
             AND (scheduled_for IS NULL OR scheduled_for <= $2)
           ORDER BY COALESCE(scheduled_for, created_at), id
           FOR UPDATE SKIP LOCKED
           LIMIT $5
         )
         RETURNING *`,
        [opts.workerId, iso(opts.now), leaseExpiresAt, opts.tenantId ?? null, opts.batchSize],
      );
      return res.rows.map((row) => decodeReservedMessage(row, codec));
    },

    async recordAttempt(attempt: NewAttempt, opts?: HostTxOption<PgQueryable>) {
      await ready();
      const [text, values] = buildInsert("attempts", encodeAttemptInsert(attempt, codec));
      await exec(opts).query(text, values);
    },

    async renewLease(messageId, workerId, leaseMs, now) {
      const res = await pool().query(
        "UPDATE messages SET lease_expires_at = $1 WHERE id = $2 AND reserved_by = $3",
        [new Date(now.getTime() + leaseMs), messageId, workerId],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async releaseLease(messageId, workerId) {
      await pool().query(
        `UPDATE messages SET reserved_by = NULL, reserved_at = NULL, lease_expires_at = NULL
         WHERE id = $1 AND reserved_by = $2`,
        [messageId, workerId],
      );
    },

    async expireStaleLeases(now) {
      const res = await pool().query(
        `UPDATE messages SET reserved_by = NULL, reserved_at = NULL, lease_expires_at = NULL
         WHERE reserved_by IS NOT NULL AND (lease_expires_at IS NULL OR lease_expires_at <= $1)`,
        [iso(now)],
      );
      return res.rowCount ?? 0;
    },

    async markMessageFinal(messageId, status) {
      await pool().query(
        `UPDATE messages SET status = $1, reserved_by = NULL, reserved_at = NULL,
           lease_expires_at = NULL WHERE id = $2`,
        [status, messageId],
      );
    },

    async rescheduleMessage(messageId, opts: RescheduleOpts<PgQueryable>) {
      const q = exec(opts);
      const res =
        opts.replayOf !== undefined
          ? await q.query(
              `UPDATE messages SET scheduled_for = $1, reserved_by = NULL, reserved_at = NULL,
                 lease_expires_at = NULL, status = 'pending', replay_of = $2 WHERE id = $3`,
              [iso(opts.scheduledFor), opts.replayOf, messageId],
            )
          : await q.query(
              `UPDATE messages SET scheduled_for = $1, reserved_by = NULL, reserved_at = NULL,
                 lease_expires_at = NULL, status = 'pending' WHERE id = $2`,
              [iso(opts.scheduledFor), messageId],
            );
      return (res.rowCount ?? 0) > 0;
    },

    async loadEndpointsForMessage(messageId) {
      await ready();
      const msg = await pool().query<{ tenant_id: string | null }>(
        "SELECT tenant_id FROM messages WHERE id = $1",
        [messageId],
      );
      if (msg.rows.length === 0) return [];
      const tenantId = msg.rows[0]?.tenant_id ?? null;
      const endpointRows = await pool().query(
        "SELECT * FROM endpoints WHERE tenant_id IS NOT DISTINCT FROM $1 ORDER BY created_at, id",
        [tenantId],
      );
      const out: EndpointWithSecrets[] = [];
      for (const row of endpointRows.rows) {
        const endpoint = attachCallbacks(decodeEndpoint(row, codec), registry);
        const secretRows = await pool().query(
          "SELECT * FROM endpoint_secrets WHERE endpoint_id = $1 ORDER BY priority",
          [endpoint.id],
        );
        out.push({ endpoint, secrets: secretRows.rows.map((s) => decodeSecret(s, codec)) });
      }
      return out;
    },

    async getMessage(id, opts) {
      await ready();
      const res = await exec(opts).query("SELECT * FROM messages WHERE id = $1", [id]);
      const row = res.rows[0];
      return row ? decodeStoredMessage(row, codec) : undefined;
    },

    async listMessages(filter: MessageListFilter) {
      await ready();
      const clauses: string[] = [];
      const values: unknown[] = [];
      if (filter.tenantId !== undefined) {
        values.push(filter.tenantId);
        clauses.push(`tenant_id = $${values.length}`);
      }
      if (filter.since !== undefined) {
        values.push(iso(filter.since));
        clauses.push(`created_at >= $${values.length}`);
      }
      if (filter.until !== undefined) {
        values.push(iso(filter.until));
        clauses.push(`created_at <= $${values.length}`);
      }
      if (filter.types !== undefined && filter.types.length > 0) {
        values.push(filter.types);
        clauses.push(`type = ANY($${values.length})`);
      }
      if (filter.status !== undefined && filter.status.length > 0) {
        values.push(filter.status);
        clauses.push(`status = ANY($${values.length})`);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      values.push(filter.limit ?? DEFAULT_MESSAGE_LIST_LIMIT);
      const res = await pool().query(
        `SELECT * FROM messages ${where} ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
        values,
      );
      return res.rows.map((row) => decodeStoredMessage(row, codec));
    },

    async *rangeQuery(filter: RangeQueryFilter) {
      await ready();
      const clauses: string[] = [];
      const values: unknown[] = [];
      if (filter.tenantId !== undefined) {
        values.push(filter.tenantId);
        clauses.push(`tenant_id = $${values.length}`);
      }
      if (filter.since !== undefined) {
        values.push(iso(filter.since));
        clauses.push(`created_at >= $${values.length}`);
      }
      if (filter.until !== undefined) {
        values.push(iso(filter.until));
        clauses.push(`created_at <= $${values.length}`);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const res = await pool().query(
        `SELECT * FROM messages ${where} ORDER BY created_at, id`,
        values,
      );
      for (const row of res.rows) {
        const message = decodeReservedMessage(row, codec);
        if (filter.types !== undefined && !filter.types.includes(message.type)) continue;
        if (filter.predicate !== undefined && !filter.predicate(message)) continue;
        yield message;
      }
    },

    async *reconcile(filter: ReconcileFilter) {
      await ready();
      const values: unknown[] = [iso(filter.since)];
      let where = "created_at >= $1";
      if (filter.tenantId !== undefined) {
        values.push(filter.tenantId);
        where += ` AND tenant_id = $${values.length}`;
      }
      const res = await pool().query<{ id: string }>(
        `SELECT id, created_at FROM messages WHERE ${where} ORDER BY created_at, id`,
        values,
      );
      for (const row of res.rows) {
        const last = await pool().query<{ status: string }>(
          `SELECT status FROM attempts WHERE message_id = $1 AND endpoint_id = $2
           ORDER BY attempt_number DESC LIMIT 1`,
          [row.id, filter.endpointId],
        );
        if (last.rows.length === 0 || last.rows[0]?.status !== "success") yield row.id as MessageId;
      }
    },

    async countPendingByTenant() {
      await ready();
      const res = await pool().query<{ tenant_id: string | null; count: string }>(
        "SELECT tenant_id, COUNT(*) AS count FROM messages WHERE status = 'pending' GROUP BY tenant_id",
      );
      const out = new Map<TenantId | "_null", number>();
      for (const row of res.rows) out.set(row.tenant_id ?? "_null", Number(row.count));
      return out;
    },

    async outboxDepth(opts) {
      await ready();
      const tenantClause = opts?.tenantId !== undefined ? "AND tenant_id = $1" : "";
      const res = await pool().query<{ depth: string; oldest: Date | null }>(
        `SELECT COUNT(*) AS depth, MIN(created_at) AS oldest FROM messages
         WHERE status = 'pending' ${tenantClause}`,
        opts?.tenantId !== undefined ? [opts.tenantId] : [],
      );
      const row = res.rows[0];
      const oldest = row?.oldest ?? null;
      return {
        depth: Number(row?.depth ?? 0),
        oldestPendingAge: oldest ? clock.now().getTime() - new Date(oldest).getTime() : undefined,
      };
    },

    attempts: {
      async countSince(endpointId, since) {
        const res = await pool().query<{ status: string }>(
          `SELECT status FROM attempts
           WHERE endpoint_id = $1
             AND COALESCE(completed_at, started_at, scheduled_for, $2) >= $2`,
          [endpointId, iso(since)],
        );
        let failureCount = 0;
        for (const row of res.rows) if (FAILURE_STATUSES.has(row.status)) failureCount += 1;
        return { count: res.rows.length, failureCount };
      },
      async latestForMessage(messageId) {
        const res = await pool().query(
          "SELECT * FROM attempts WHERE message_id = $1 ORDER BY attempt_number",
          [messageId],
        );
        return res.rows.map((row) => decodeAttempt(row, codec));
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
        const [text, values] = buildInsert("endpoints", encodeEndpointInsert(full, codec));
        await exec(opts).query(text, values);
        registry.set(full.id, { filter: full.filter, transform: full.transform });
        return full;
      },
      async update(id, patch, opts) {
        return atomic(opts?.tx, async (q) => {
          const prev = await loadEndpointRecord(q, id);
          if (!prev) throw new Error(`endpoint not found: ${id}`);
          const next: EndpointRecord = { ...prev, ...patch, id: prev.id, updatedAt: clock.now() };
          const {
            tenant_id,
            url,
            state,
            types,
            channels,
            retry_policy,
            headers,
            signing,
            metadata,
            allow_http,
            max_inflight,
            http,
            circuit_breaker,
            auto_disable,
            updated_at,
          } = encodeEndpointInsert(next, codec);
          await q.query(
            `UPDATE endpoints SET tenant_id = $1, url = $2, state = $3, types = $4, channels = $5,
               retry_policy = $6, headers = $7, signing = $8, metadata = $9, allow_http = $10,
               max_inflight = $11, http = $12, circuit_breaker = $13, auto_disable = $14,
               updated_at = $15 WHERE id = $16`,
            [
              tenant_id,
              url,
              state,
              types,
              channels,
              retry_policy,
              headers,
              signing,
              metadata,
              allow_http,
              max_inflight,
              http,
              circuit_breaker,
              auto_disable,
              updated_at,
              id,
            ].map(normalize),
          );
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
          await q.query("DELETE FROM endpoint_secrets WHERE endpoint_id = $1", [id]);
          if (opts?.purgeAttempts === true) {
            await q.query("DELETE FROM attempts WHERE endpoint_id = $1", [id]);
            await q.query("DELETE FROM endpoint_state_transitions WHERE endpoint_id = $1", [id]);
          }
          await q.query("DELETE FROM endpoints WHERE id = $1", [id]);
        });
        registry.delete(id);
      },
      async list(opts) {
        await ready();
        const res =
          opts?.tenantId !== undefined
            ? await pool().query(
                "SELECT * FROM endpoints WHERE tenant_id = $1 ORDER BY created_at, id",
                [opts.tenantId],
              )
            : await pool().query("SELECT * FROM endpoints ORDER BY created_at, id");
        return res.rows.map((row) => attachCallbacks(decodeEndpoint(row, codec), registry));
      },
      async get(id) {
        await ready();
        return loadEndpointRecord(pool(), id);
      },
      async transitionState(id, to, reason, actor, metadata, opts) {
        return atomic(opts?.tx, async (q) => {
          const prevRes = await q.query<{ state: EndpointState }>(
            "SELECT state FROM endpoints WHERE id = $1",
            [id],
          );
          const prev = prevRes.rows[0];
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
            await q.query(
              `INSERT INTO endpoint_state_transitions
                 (id, endpoint_id, from_state, to_state, reason, actor, metadata, occurred_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                transitionId,
                id,
                prev.state,
                to,
                reason,
                actor,
                metadata === undefined ? null : JSON.stringify(metadata),
                occurredAt,
              ],
            );
            await q.query("UPDATE endpoints SET state = $1, updated_at = $2 WHERE id = $3", [
              to,
              occurredAt,
              id,
            ]);
          }
          return transition;
        });
      },
      async listStateTransitions(id) {
        const res = await pool().query<{
          id: string;
          endpoint_id: string;
          from_state: EndpointState | null;
          to_state: EndpointState | null;
          reason: string;
          actor: string | null;
          metadata: Record<string, unknown> | null;
          occurred_at: Date;
        }>(
          "SELECT * FROM endpoint_state_transitions WHERE endpoint_id = $1 ORDER BY occurred_at, id",
          [id],
        );
        return res.rows.map((row) => ({
          id: row.id,
          endpointId: row.endpoint_id,
          fromState: row.from_state ?? null,
          toState: row.to_state ?? null,
          reason: row.reason,
          actor: row.actor ?? null,
          metadata: row.metadata ?? null,
          occurredAt: new Date(row.occurred_at),
        }));
      },
    },

    secrets: {
      async insert(rec, opts) {
        await ready();
        const full: EndpointSecretRecord = { ...rec, createdAt: clock.now() };
        const [text, values] = buildInsert("endpoint_secrets", {
          ...encodeSecretInsert(rec, codec),
          created_at: full.createdAt,
        });
        await exec(opts).query(text, values);
        return full;
      },
      async listForEndpoint(endpointId) {
        const res = await pool().query(
          "SELECT * FROM endpoint_secrets WHERE endpoint_id = $1 ORDER BY priority",
          [endpointId],
        );
        return res.rows.map((row) => decodeSecret(row, codec));
      },
      async setStatus(secretId, status, notAfter, opts) {
        await exec(opts).query(
          "UPDATE endpoint_secrets SET status = $1, not_after = $2 WHERE id = $3",
          [status, notAfter, secretId],
        );
      },
      async deleteExpired(now) {
        const res = await pool().query(
          "DELETE FROM endpoint_secrets WHERE not_after IS NOT NULL AND not_after <= $1",
          [iso(now)],
        );
        return res.rowCount ?? 0;
      },
    },

    tenants: {
      async upsert(tenantId, metadata, opts) {
        await ready();
        return atomic(opts?.tx, async (q) => {
          const existing = await q.query<{ created_at: Date }>(
            "SELECT created_at FROM tenants WHERE id = $1",
            [tenantId],
          );
          const createdAt = existing.rows[0] ? new Date(existing.rows[0].created_at) : clock.now();
          await q.query(
            `INSERT INTO tenants (id, metadata, created_at) VALUES ($1, $2, $3)
             ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata`,
            [tenantId, metadata === null ? null : JSON.stringify(metadata), createdAt],
          );
          const rec: TenantRecord = { id: tenantId, metadata, createdAt };
          return rec;
        });
      },
      async get(tenantId, opts) {
        const res = await exec(opts).query("SELECT * FROM tenants WHERE id = $1", [tenantId]);
        const row = res.rows[0];
        return row ? decodeTenant(row, codec) : undefined;
      },
      async list(filter: TenantListFilter) {
        const clauses: string[] = [];
        const values: unknown[] = [];
        if (filter.cursor !== undefined) {
          const { createdAt, id } = decodeTenantCursor(filter.cursor);
          values.push(createdAt, id);
          clauses.push(
            `(created_at < $${values.length - 1} OR (created_at = $${values.length - 1} AND id < $${values.length}))`,
          );
        }
        const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
        const limit = filter.limit ?? DEFAULT_TENANT_LIST_LIMIT;
        values.push(limit + 1);
        const res = await pool().query(
          `SELECT * FROM tenants ${where} ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
          values,
        );
        const rows = res.rows.map((row) => decodeTenant(row, codec));
        const items = rows.slice(0, limit);
        const last = items[items.length - 1];
        const nextCursor = rows.length > limit && last ? encodeTenantCursor(last) : null;
        return { items, nextCursor };
      },
      async delete(tenantId, opts) {
        await atomic(opts?.tx, async (q) => {
          const endpointRows = await q.query<{ id: string }>(
            "SELECT id FROM endpoints WHERE tenant_id = $1",
            [tenantId],
          );
          await q.query(
            "DELETE FROM endpoint_secrets WHERE endpoint_id IN (SELECT id FROM endpoints WHERE tenant_id = $1)",
            [tenantId],
          );
          await q.query(
            "DELETE FROM endpoint_state_transitions WHERE endpoint_id IN (SELECT id FROM endpoints WHERE tenant_id = $1)",
            [tenantId],
          );
          await q.query("DELETE FROM attempts WHERE tenant_id = $1", [tenantId]);
          await q.query("DELETE FROM messages WHERE tenant_id = $1", [tenantId]);
          await q.query("DELETE FROM endpoints WHERE tenant_id = $1", [tenantId]);
          await q.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
          for (const row of endpointRows.rows) registry.delete(row.id);
        });
      },
    },

    async dedup(messageId, opts) {
      await ready();
      const q = exec(opts);
      const nowIso = clock.now();
      const expires = new Date(clock.now().getTime() + opts.ttlSeconds * 1000);
      const res = await q.query(
        `INSERT INTO postel_received_messages (message_id, expires_at)
         VALUES ($1, $2)
         ON CONFLICT (message_id) DO UPDATE SET expires_at = EXCLUDED.expires_at
           WHERE postel_received_messages.expires_at <= $3
         RETURNING message_id`,
        [messageId, expires, nowIso],
      );
      return { duplicate: (res.rowCount ?? 0) === 0 };
    },

    async transaction<R>(cb: (tx: PgQueryable) => Promise<R>): Promise<R> {
      await ready();
      const client = await pool().connect();
      try {
        await client.query("BEGIN");
        const result = await cb(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async notify(channel, payload) {
      await pool().query("SELECT pg_notify($1, $2)", [channel, payload ?? ""]);
    },

    subscribe(channel, handler) {
      let client: PgPoolClient | undefined;
      let closed = false;
      void pool()
        .connect()
        .then(async (c) => {
          if (closed) {
            c.release();
            return;
          }
          client = c;
          c.on("notification", (msg) => {
            if (msg.channel === channel) handler(msg.payload ?? "");
          });
          await c.query(`LISTEN ${quoteIdent(channel)}`);
        });
      return () => {
        closed = true;
        if (client) {
          const c = client;
          void c.query(`UNLISTEN ${quoteIdent(channel)}`).finally(() => c.release());
        }
      };
    },
  };
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function cryptoId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
