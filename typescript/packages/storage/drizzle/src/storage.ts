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
  type ColumnCodec,
  DEFAULT_MESSAGE_LIST_LIMIT,
  MYSQL_CAPABILITIES,
  MYSQL_CODEC,
  MYSQL_MIGRATIONS,
  PG_CAPABILITIES,
  PG_MIGRATIONS,
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
import { type SQL, sql } from "drizzle-orm";
import type { MySqlDatabase } from "drizzle-orm/mysql-core";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

export type DrizzleDialect = "postgres" | "mysql" | "sqlite";

/**
 * A real Drizzle database instance. Every driver's `db` extends one of Drizzle's
 * public base classes — `BaseSQLiteDatabase` (better-sqlite3, bun:sqlite, libSQL,
 * …) or `PgDatabase` (node-postgres, postgres-js, …) — so you hand Postel the
 * `db` you already built, with no Postel-specific wrapper type.
 */
export type DrizzleDatabase =
  // biome-ignore lint/suspicious/noExplicitAny: mirrors Drizzle's own base-class generics
  | BaseSQLiteDatabase<any, any>
  // biome-ignore lint/suspicious/noExplicitAny: mirrors Drizzle's own base-class generics
  | PgDatabase<any, any, any>
  // biome-ignore lint/suspicious/noExplicitAny: mirrors Drizzle's own base-class generics
  | MySqlDatabase<any, any>;

// The structural slice the adapter calls internally, and the handle it threads
// through `HostTxOption`. A Postgres db's `execute` resolves to `{ rows, rowCount }`;
// a MySQL db's `execute` resolves to a `[rows, ResultSetHeader]` tuple; a SQLite db
// exposes sync `all` / `run`.
export interface DrizzleDb {
  execute?(query: SQL): Promise<{ rows: unknown[]; rowCount?: number | null } | [unknown, unknown]>;
  all?(query: SQL): unknown[];
  run?(query: SQL): { changes?: number | bigint };
  transaction?<R>(
    cb: (tx: DrizzleDb) => Promise<R>,
    config?: { isolationLevel?: string },
  ): Promise<R>;
}

export interface DrizzleStorageOptions {
  readonly db: DrizzleDatabase;
  readonly dialect: DrizzleDialect;
  readonly clock?: Clock;
  readonly autoMigrate?: boolean;
}

const PG_CODEC: ColumnCodec = { time: "native", json: "text" };

function statements(migrationSql: string): string[] {
  return migrationSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function DrizzleStorage(options: DrizzleStorageOptions): Storage<DrizzleDb> {
  const db = options.db as unknown as DrizzleDb;
  const { dialect } = options;
  const isPg = dialect === "postgres";
  const isMysql = dialect === "mysql";
  // MySQL: order by the indexed created_at (the (status, created_at) index) so the
  // FOR UPDATE SKIP LOCKED scan streams instead of filesorting — a FOR UPDATE
  // filesort locks every examined row, starving concurrent workers.
  const reserveOrder = sql.raw(
    isMysql ? "created_at, id" : "coalesce(scheduled_for, created_at), id",
  );
  const codec = isPg ? PG_CODEC : isMysql ? MYSQL_CODEC : SQLITE_CODEC;
  // Null-safe equality: Postgres IS NOT DISTINCT FROM; MySQL <=>; SQLite IS.
  const distinctOp = sql.raw(isPg ? "is not distinct from" : isMysql ? "<=>" : "is");
  const clock: Clock = options.clock ?? { now: () => new Date(), sleep: async () => {} };
  const registry = createCallbackRegistry();
  let migrated = false;

  function bind(value: unknown): unknown {
    if (value === undefined) return null;
    if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value);
    if (!isPg && typeof value === "boolean") return value ? 1 : 0;
    return value;
  }

  function tsParam(date: Date): unknown {
    // MySQL stores epoch-ms BIGINT; SQLite ISO-8601 text; Postgres native Date.
    return isPg ? date : isMysql ? date.getTime() : date.toISOString();
  }

  async function rows<R>(on: DrizzleDb, query: SQL): Promise<R[]> {
    // MySQL's execute resolves to a [rows, header] tuple; Postgres to { rows }.
    if (isMysql) {
      const res = (await on.execute?.(query)) as [R[], unknown] | undefined;
      return (res?.[0] ?? []) as R[];
    }
    if (isPg) return ((await on.execute?.(query)) as { rows: unknown[] } | undefined)?.rows as R[];
    return (on.all?.(query) ?? []) as R[];
  }

  async function run(on: DrizzleDb, query: SQL): Promise<number> {
    if (isMysql) {
      const res = (await on.execute?.(query)) as [{ affectedRows?: number }, unknown] | undefined;
      return Number(res?.[0]?.affectedRows ?? 0);
    }
    if (isPg) {
      const res = (await on.execute?.(query)) as { rowCount?: number | null } | undefined;
      return Number(res?.rowCount ?? 0);
    }
    return Number(on.run?.(query)?.changes ?? 0);
  }

  async function insert(on: DrizzleDb, table: string, row: Record<string, unknown>): Promise<void> {
    const cols = Object.keys(row);
    const idents = sql.join(
      cols.map((c) => sql.identifier(c)),
      sql`, `,
    );
    const values = sql.join(
      cols.map((c) => sql`${bind(row[c])}`),
      sql`, `,
    );
    await run(on, sql`insert into ${sql.identifier(table)} (${idents}) values (${values})`);
  }

  async function migrate(): Promise<void> {
    let current = 0;
    try {
      const res = await rows<{ value: string }>(
        db,
        sql`select value from _postel_meta where ${sql.identifier("key")} = 'schema_version'`,
      );
      if (res[0]?.value !== undefined) current = Number(res[0].value);
    } catch {
      current = 0;
    }
    for (const m of isPg ? PG_MIGRATIONS : isMysql ? MYSQL_MIGRATIONS : SQLITE_MIGRATIONS) {
      if (m.version <= current) continue;
      for (const stmt of statements(m.sql)) await run(db, sql.raw(stmt));
    }
    const dedupDdl = isPg
      ? "create table if not exists postel_received_messages (message_id text primary key, expires_at timestamptz not null)"
      : isMysql
        ? "create table if not exists postel_received_messages (message_id varchar(191) primary key, expires_at bigint not null)"
        : "create table if not exists postel_received_messages (message_id text primary key, expires_at text not null)";
    await run(db, sql.raw(dedupDdl));
    migrated = true;
  }

  async function ready(): Promise<void> {
    if (options.autoMigrate === false || migrated) return;
    await migrate();
  }

  function exec(opts?: HostTxOption<DrizzleDb>): DrizzleDb {
    return opts?.tx ?? db;
  }

  async function atomic<R>(
    tx: DrizzleDb | undefined,
    fn: (q: DrizzleDb) => Promise<R>,
  ): Promise<R> {
    if (tx) return fn(tx);
    if ((isPg || isMysql) && db.transaction) {
      // READ COMMITTED on MySQL: the default REPEATABLE READ gap-locks the range
      // a FOR UPDATE SKIP LOCKED scan touches, which makes concurrent workers
      // under-reserve. READ COMMITTED takes only record locks.
      return isMysql
        ? db.transaction((trx) => fn(trx), { isolationLevel: "read committed" })
        : db.transaction((trx) => fn(trx));
    }
    // SQLite: drive BEGIN/COMMIT manually so an async callback is supported
    // (better-sqlite3's own transaction() requires a sync callback).
    await run(db, sql.raw("begin"));
    try {
      const result = await fn(db);
      await run(db, sql.raw("commit"));
      return result;
    } catch (err) {
      await run(db, sql.raw("rollback"));
      throw err;
    }
  }

  async function loadEndpointRecord(
    q: DrizzleDb,
    id: EndpointId,
  ): Promise<EndpointRecord | undefined> {
    const res = await rows<Record<string, unknown>>(
      q,
      sql`select * from endpoints where id = ${id}`,
    );
    const row = res[0];
    if (!row) return undefined;
    return attachCallbacks(decodeEndpoint(row, codec), registry);
  }

  const FAILURE_STATUSES = new Set([
    "failed",
    "failed-permanent",
    "dead-letter",
    "ssrf-blocked",
    "expired",
  ]);

  return {
    capabilities: isPg ? PG_CAPABILITIES : isMysql ? MYSQL_CAPABILITIES : SQLITE_CAPABILITIES,

    async schemaVersion() {
      await ready();
      const res = await rows<{ value: string }>(
        db,
        sql`select value from _postel_meta where ${sql.identifier("key")} = 'schema_version'`,
      );
      return res[0]?.value === undefined ? 0 : Number(res[0].value);
    },

    async insertMessage(msg: NewMessage, opts?: HostTxOption<DrizzleDb>) {
      await ready();
      await insert(exec(opts), "messages", encodeMessageInsert(msg, codec));
      return msg.id;
    },

    async insertOrReuseByIdempotencyKey(
      msg: NewMessage,
      opts?: HostTxOption<DrizzleDb>,
    ): Promise<InsertOrReuseResult> {
      await ready();
      if (msg.idempotencyKey === null) {
        const id = await this.insertMessage(msg, opts);
        return { id, reused: false };
      }
      return atomic(opts?.tx, async (q) => {
        const existing = await rows<{ id: string }>(
          q,
          sql`select id from messages where tenant_id ${distinctOp} ${msg.tenantId}
            and idempotency_key = ${msg.idempotencyKey} limit 1`,
        );
        if (existing[0]?.id !== undefined) return { id: existing[0].id, reused: true };
        await insert(q, "messages", encodeMessageInsert(msg, codec));
        return { id: msg.id, reused: false };
      });
    },

    async reserveBatch(opts: ReserveBatchOpts): Promise<ReadonlyArray<ReservedMessage>> {
      await ready();
      const now = tsParam(opts.now);
      const lease = tsParam(new Date(opts.now.getTime() + opts.leaseMs));
      const tenantCond =
        opts.tenantId !== undefined ? sql`and tenant_id = ${opts.tenantId}` : sql``;
      // MySQL has no RETURNING: lock due rows (FOR UPDATE SKIP LOCKED), stamp them,
      // read them back — one transaction so the lock holds.
      if (isMysql) {
        return atomic(undefined, async (trx) => {
          const selected = await rows<{ id: string }>(
            trx,
            sql`select id from messages
              where status = 'pending' and reserved_by is null
                ${tenantCond}
                and (scheduled_for is null or scheduled_for <= ${now})
              order by ${reserveOrder}
              limit ${opts.batchSize}
              for update skip locked`,
          );
          if (selected.length === 0) return [];
          const idList = sql.join(
            selected.map((r) => sql`${r.id}`),
            sql`, `,
          );
          await run(
            trx,
            sql`update messages set reserved_by = ${opts.workerId}, reserved_at = ${now},
              lease_expires_at = ${lease}, attempt_number = attempt_number + 1
              where id in (${idList})`,
          );
          const reservedRows = await rows<Record<string, unknown>>(
            trx,
            sql`select * from messages where id in (${idList}) order by ${reserveOrder}`,
          );
          return reservedRows.map((row) => decodeReservedMessage(row, codec));
        });
      }
      const lock = isPg ? sql`for update skip locked` : sql``;
      const reserved = await rows<Record<string, unknown>>(
        db,
        sql`update messages
          set reserved_by = ${opts.workerId}, reserved_at = ${now}, lease_expires_at = ${lease},
              attempt_number = attempt_number + 1
          where id in (
            select id from messages
            where status = 'pending' and reserved_by is null
              ${tenantCond}
              and (scheduled_for is null or scheduled_for <= ${now})
            order by ${reserveOrder}
            ${lock}
            limit ${opts.batchSize}
          )
          returning *`,
      );
      return reserved.map((row) => decodeReservedMessage(row, codec));
    },

    async recordAttempt(attempt: NewAttempt, opts?: HostTxOption<DrizzleDb>) {
      await ready();
      await insert(exec(opts), "attempts", encodeAttemptInsert(attempt, codec));
    },

    async renewLease(messageId, workerId, leaseMs, now) {
      const changes = await run(
        db,
        sql`update messages set lease_expires_at = ${tsParam(new Date(now.getTime() + leaseMs))}
          where id = ${messageId} and reserved_by = ${workerId}`,
      );
      return changes > 0;
    },

    async releaseLease(messageId, workerId) {
      await run(
        db,
        sql`update messages set reserved_by = null, reserved_at = null, lease_expires_at = null
          where id = ${messageId} and reserved_by = ${workerId}`,
      );
    },

    async expireStaleLeases(now) {
      return run(
        db,
        sql`update messages set reserved_by = null, reserved_at = null, lease_expires_at = null
          where reserved_by is not null and (lease_expires_at is null or lease_expires_at <= ${tsParam(now)})`,
      );
    },

    async markMessageFinal(messageId, status) {
      await run(
        db,
        sql`update messages set status = ${status}, reserved_by = null, reserved_at = null,
          lease_expires_at = null where id = ${messageId}`,
      );
    },

    async rescheduleMessage(messageId, opts: RescheduleOpts<DrizzleDb>) {
      const q = exec(opts);
      const scheduledFor = tsParam(opts.scheduledFor);
      const changes =
        opts.replayOf !== undefined
          ? await run(
              q,
              sql`update messages set scheduled_for = ${scheduledFor}, reserved_by = null,
                reserved_at = null, lease_expires_at = null, status = 'pending', replay_of = ${opts.replayOf}
                where id = ${messageId}`,
            )
          : await run(
              q,
              sql`update messages set scheduled_for = ${scheduledFor}, reserved_by = null,
                reserved_at = null, lease_expires_at = null, status = 'pending' where id = ${messageId}`,
            );
      return changes > 0;
    },

    async loadEndpointsForMessage(messageId) {
      await ready();
      const msg = await rows<{ tenant_id: string | null }>(
        db,
        sql`select tenant_id from messages where id = ${messageId}`,
      );
      if (msg.length === 0) return [];
      const tenantId = msg[0]?.tenant_id ?? null;
      const endpointRows = await rows<Record<string, unknown>>(
        db,
        sql`select * from endpoints where tenant_id ${distinctOp} ${tenantId} order by created_at, id`,
      );
      const out: EndpointWithSecrets[] = [];
      for (const row of endpointRows) {
        const endpoint = attachCallbacks(decodeEndpoint(row, codec), registry);
        const secretRows = await rows<Record<string, unknown>>(
          db,
          sql`select * from endpoint_secrets where endpoint_id = ${endpoint.id} order by priority`,
        );
        out.push({ endpoint, secrets: secretRows.map((s) => decodeSecret(s, codec)) });
      }
      return out;
    },

    async getMessage(id, opts) {
      await ready();
      const res = await rows<Record<string, unknown>>(
        exec(opts),
        sql`select * from messages where id = ${id}`,
      );
      const row = res[0];
      return row ? decodeStoredMessage(row, codec) : undefined;
    },

    async listMessages(filter: MessageListFilter) {
      await ready();
      const conds = [sql`1 = 1`];
      if (filter.tenantId !== undefined) conds.push(sql`tenant_id = ${filter.tenantId}`);
      if (filter.since !== undefined) conds.push(sql`created_at >= ${tsParam(filter.since)}`);
      if (filter.until !== undefined) conds.push(sql`created_at <= ${tsParam(filter.until)}`);
      if (filter.types !== undefined && filter.types.length > 0) {
        conds.push(
          sql`type in (${sql.join(
            filter.types.map((t) => sql`${t}`),
            sql`, `,
          )})`,
        );
      }
      if (filter.status !== undefined && filter.status.length > 0) {
        conds.push(
          sql`status in (${sql.join(
            filter.status.map((s) => sql`${s}`),
            sql`, `,
          )})`,
        );
      }
      const where = sql.join(conds, sql` and `);
      const limit = filter.limit ?? DEFAULT_MESSAGE_LIST_LIMIT;
      const res = await rows<Record<string, unknown>>(
        db,
        sql`select * from messages where ${where} order by created_at desc, id desc limit ${limit}`,
      );
      return res.map((row) => decodeStoredMessage(row, codec));
    },

    async *rangeQuery(filter: RangeQueryFilter) {
      await ready();
      const conds = [sql`1 = 1`];
      if (filter.tenantId !== undefined) conds.push(sql`tenant_id = ${filter.tenantId}`);
      if (filter.since !== undefined) conds.push(sql`created_at >= ${tsParam(filter.since)}`);
      if (filter.until !== undefined) conds.push(sql`created_at <= ${tsParam(filter.until)}`);
      const where = sql.join(conds, sql` and `);
      const res = await rows<Record<string, unknown>>(
        db,
        sql`select * from messages where ${where} order by created_at, id`,
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
      const conds = [sql`created_at >= ${tsParam(filter.since)}`];
      if (filter.tenantId !== undefined) conds.push(sql`tenant_id = ${filter.tenantId}`);
      const where = sql.join(conds, sql` and `);
      const res = await rows<{ id: string }>(
        db,
        sql`select id, created_at from messages where ${where} order by created_at, id`,
      );
      for (const row of res) {
        const last = await rows<{ status: string }>(
          db,
          sql`select status from attempts where message_id = ${row.id} and endpoint_id = ${filter.endpointId}
            order by attempt_number desc limit 1`,
        );
        if (last.length === 0 || last[0]?.status !== "success") yield row.id as MessageId;
      }
    },

    async countPendingByTenant() {
      await ready();
      const res = await rows<{ tenant_id: string | null; count: number | string | bigint }>(
        db,
        sql`select tenant_id, count(*) as count from messages where status = 'pending' group by tenant_id`,
      );
      const out = new Map<TenantId | "_null", number>();
      for (const row of res) out.set(row.tenant_id ?? "_null", Number(row.count));
      return out;
    },

    async outboxDepth(opts) {
      await ready();
      const tenantCond =
        opts?.tenantId !== undefined ? sql`and tenant_id = ${opts.tenantId}` : sql``;
      const res = await rows<{ depth: number | string | bigint; oldest: string | Date | null }>(
        db,
        sql`select count(*) as depth, min(created_at) as oldest from messages
          where status = 'pending' ${tenantCond}`,
      );
      const row = res[0];
      const oldest = row?.oldest ?? null;
      return {
        depth: Number(row?.depth ?? 0),
        oldestPendingAge: oldest ? clock.now().getTime() - new Date(oldest).getTime() : undefined,
      };
    },

    attempts: {
      async countSince(endpointId, since) {
        const res = await rows<{ status: string }>(
          db,
          sql`select status from attempts where endpoint_id = ${endpointId}
            and coalesce(completed_at, started_at, scheduled_for, ${tsParam(since)}) >= ${tsParam(since)}`,
        );
        let failureCount = 0;
        for (const row of res) if (FAILURE_STATUSES.has(row.status)) failureCount += 1;
        return { count: res.length, failureCount };
      },
      async latestForMessage(messageId) {
        const res = await rows<Record<string, unknown>>(
          db,
          sql`select * from attempts where message_id = ${messageId} order by attempt_number`,
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
          const assignments = sql.join(
            Object.keys(row)
              .filter((c) => c !== "id" && c !== "created_at")
              .map((c) => sql`${sql.identifier(c)} = ${bind(row[c])}`),
            sql`, `,
          );
          await run(q, sql`update endpoints set ${assignments} where id = ${id}`);
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
          await run(q, sql`delete from endpoint_secrets where endpoint_id = ${id}`);
          if (opts?.purgeAttempts === true) {
            await run(q, sql`delete from attempts where endpoint_id = ${id}`);
            await run(q, sql`delete from endpoint_state_transitions where endpoint_id = ${id}`);
          }
          await run(q, sql`delete from endpoints where id = ${id}`);
        });
        registry.delete(id);
      },
      async list(opts) {
        await ready();
        const where =
          opts?.tenantId !== undefined ? sql`where tenant_id = ${opts.tenantId}` : sql``;
        const res = await rows<Record<string, unknown>>(
          db,
          sql`select * from endpoints ${where} order by created_at, id`,
        );
        return res.map((row) => attachCallbacks(decodeEndpoint(row, codec), registry));
      },
      async get(id) {
        await ready();
        return loadEndpointRecord(db, id);
      },
      async transitionState(id, to, reason, actor, metadata, opts) {
        return atomic(opts?.tx, async (q) => {
          const prevRes = await rows<{ state: EndpointState }>(
            q,
            sql`select state from endpoints where id = ${id}`,
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
              occurred_at: tsParam(occurredAt),
            });
            await run(
              q,
              sql`update endpoints set state = ${to}, updated_at = ${tsParam(occurredAt)} where id = ${id}`,
            );
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
          occurred_at: string | Date;
        }>(
          db,
          sql`select * from endpoint_state_transitions where endpoint_id = ${id} order by occurred_at, id`,
        );
        return res.map((row) => ({
          id: row.id,
          endpointId: row.endpoint_id,
          fromState: row.from_state ?? null,
          toState: row.to_state ?? null,
          reason: row.reason,
          actor: row.actor ?? null,
          metadata:
            row.metadata === null || row.metadata === undefined
              ? null
              : typeof row.metadata === "string"
                ? (JSON.parse(row.metadata) as Record<string, unknown>)
                : (row.metadata as Record<string, unknown>),
          occurredAt: new Date(row.occurred_at),
        }));
      },
    },

    secrets: {
      async insert(rec, opts) {
        await ready();
        const full: EndpointSecretRecord = { ...rec, createdAt: clock.now() };
        await insert(exec(opts), "endpoint_secrets", {
          ...encodeSecretInsert(rec, codec),
          created_at: tsParam(full.createdAt),
        });
        return full;
      },
      async listForEndpoint(endpointId) {
        const res = await rows<Record<string, unknown>>(
          db,
          sql`select * from endpoint_secrets where endpoint_id = ${endpointId} order by priority`,
        );
        return res.map((row) => decodeSecret(row, codec));
      },
      async setStatus(secretId, status, notAfter, opts) {
        await run(
          exec(opts),
          sql`update endpoint_secrets set status = ${status},
            not_after = ${notAfter === null ? null : tsParam(notAfter)} where id = ${secretId}`,
        );
      },
      async deleteExpired(now) {
        return run(
          db,
          sql`delete from endpoint_secrets where not_after is not null and not_after <= ${tsParam(now)}`,
        );
      },
    },

    tenants: {
      async upsert(tenantId, metadata, opts) {
        await ready();
        return atomic(opts?.tx, async (q) => {
          const existing = await rows<{ created_at: string | Date }>(
            q,
            sql`select created_at from tenants where id = ${tenantId}`,
          );
          const createdAt = existing[0] ? new Date(existing[0].created_at) : clock.now();
          const metaParam = metadata === null ? null : JSON.stringify(metadata);
          await run(
            q,
            sql`insert into tenants (id, metadata, created_at)
              values (${tenantId}, ${metaParam}, ${tsParam(createdAt)})
              on conflict (id) do update set metadata = ${metaParam}`,
          );
          const rec: TenantRecord = { id: tenantId, metadata, createdAt };
          return rec;
        });
      },
      async get(tenantId) {
        const res = await rows<{ id: string; metadata: unknown; created_at: string | Date }>(
          db,
          sql`select * from tenants where id = ${tenantId}`,
        );
        const row = res[0];
        if (!row) return undefined;
        const metadata =
          row.metadata === null || row.metadata === undefined
            ? null
            : typeof row.metadata === "string"
              ? (JSON.parse(row.metadata) as Record<string, unknown>)
              : (row.metadata as Record<string, unknown>);
        return { id: row.id, metadata, createdAt: new Date(row.created_at) };
      },
      async delete(tenantId, opts) {
        await atomic(opts?.tx, async (q) => {
          const endpointRows = await rows<{ id: string }>(
            q,
            sql`select id from endpoints where tenant_id = ${tenantId}`,
          );
          await run(
            q,
            sql`delete from endpoint_secrets where endpoint_id in (select id from endpoints where tenant_id = ${tenantId})`,
          );
          await run(
            q,
            sql`delete from endpoint_state_transitions where endpoint_id in (select id from endpoints where tenant_id = ${tenantId})`,
          );
          await run(q, sql`delete from attempts where tenant_id = ${tenantId}`);
          await run(q, sql`delete from messages where tenant_id = ${tenantId}`);
          await run(q, sql`delete from endpoints where tenant_id = ${tenantId}`);
          await run(q, sql`delete from tenants where id = ${tenantId}`);
          for (const row of endpointRows) registry.delete(row.id);
        });
      },
    },

    async dedup(messageId, opts) {
      await ready();
      const q = exec(opts);
      const nowMs = clock.now();
      const expires = tsParam(new Date(clock.now().getTime() + opts.ttlSeconds * 1000));
      // INSERT IGNORE has a clean affectedRows (1 inserted / 0 duplicate); MySQL's
      // ON DUPLICATE KEY UPDATE can't distinguish a no-op refresh from a live dup.
      if (isMysql) {
        const inserted = await run(
          q,
          sql`insert ignore into postel_received_messages (message_id, expires_at)
            values (${messageId}, ${expires})`,
        );
        if (inserted > 0) return { duplicate: false };
        const refreshed = await run(
          q,
          sql`update postel_received_messages set expires_at = ${expires}
            where message_id = ${messageId} and expires_at <= ${tsParam(nowMs)}`,
        );
        return { duplicate: refreshed === 0 };
      }
      const changes = await run(
        q,
        sql`insert into postel_received_messages (message_id, expires_at)
          values (${messageId}, ${expires})
          on conflict (message_id) do update set expires_at = ${expires}
            where postel_received_messages.expires_at <= ${tsParam(nowMs)}`,
      );
      return { duplicate: changes === 0 };
    },

    async transaction<R>(cb: (tx: DrizzleDb) => Promise<R>): Promise<R> {
      await ready();
      return atomic(undefined, cb);
    },

    async notify(channel, payload) {
      if (!isPg) return;
      await run(db, sql`select pg_notify(${channel}, ${payload ?? ""})`);
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
