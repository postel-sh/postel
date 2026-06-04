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
  encodeAttemptInsert,
  encodeEndpointInsert,
  encodeMessageInsert,
  encodeSecretInsert,
} from "@postel/storage-helpers";
import { type Kysely, type Transaction, sql } from "kysely";

export type KyselyDialect = "postgres" | "sqlite";

export interface KyselyStorageOptions<DB> {
  // The host's Kysely instance — Postel issues its queries through it (and its
  // transactions), so an outbox insert composes with the host's own writes.
  readonly db: Kysely<DB>;
  readonly dialect: KyselyDialect;
  readonly clock?: Clock;
  readonly autoMigrate?: boolean;
}

type Exec<DB> = Kysely<DB> | Transaction<DB>;

const PG_CODEC: ColumnCodec = { time: "native", json: "text" };

function statements(migrationSql: string): string[] {
  return migrationSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function KyselyStorage<DB>(options: KyselyStorageOptions<DB>): Storage<Transaction<DB>> {
  const { db, dialect } = options;
  const isPg = dialect === "postgres";
  const codec = isPg ? PG_CODEC : SQLITE_CODEC;
  // Null-safe equality: Postgres uses IS NOT DISTINCT FROM; SQLite uses IS.
  const distinctOp = isPg ? sql.raw("is not distinct from") : sql.raw("is");
  const clock: Clock = options.clock ?? { now: () => new Date(), sleep: async () => {} };
  const registry = createCallbackRegistry();
  let migrated = false;

  // SQLite (better-sqlite3) binds only numbers/strings/Buffers; Postgres binds
  // Date/boolean natively. Normalize the dialect-agnostic helper rows.
  function bind(value: unknown): unknown {
    if (value === undefined) return null;
    if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value);
    if (!isPg && typeof value === "boolean") return value ? 1 : 0;
    return value;
  }

  function tsParam(date: Date): unknown {
    return isPg ? date : date.toISOString();
  }

  function insert(exec: Exec<DB>, table: string, row: Record<string, unknown>): Promise<unknown> {
    const cols = Object.keys(row);
    const idents = sql.join(cols.map((c) => sql.ref(c)));
    const values = sql.join(cols.map((c) => sql`${bind(row[c])}`));
    return sql`insert into ${sql.ref(table)} (${idents}) values (${values})`.execute(exec);
  }

  async function migrate(): Promise<void> {
    let current = 0;
    try {
      const res = await sql<{
        value: string;
      }>`select value from _postel_meta where key = 'schema_version'`.execute(db);
      if (res.rows[0]?.value !== undefined) current = Number(res.rows[0].value);
    } catch {
      current = 0;
    }
    for (const m of isPg ? PG_MIGRATIONS : SQLITE_MIGRATIONS) {
      if (m.version <= current) continue;
      for (const stmt of statements(m.sql)) await sql.raw(stmt).execute(db);
    }
    await sql`create table if not exists postel_received_messages (
      message_id text primary key,
      expires_at ${sql.raw(isPg ? "timestamptz" : "text")} not null
    )`.execute(db);
    migrated = true;
  }

  async function ready(): Promise<void> {
    if (options.autoMigrate === false || migrated) return;
    await migrate();
  }

  function exec(opts?: HostTxOption<Transaction<DB>>): Exec<DB> {
    return opts?.tx ?? db;
  }

  async function atomic<R>(
    tx: Transaction<DB> | undefined,
    fn: (q: Exec<DB>) => Promise<R>,
  ): Promise<R> {
    if (tx) return fn(tx);
    return db.transaction().execute((trx) => fn(trx));
  }

  async function loadEndpointRecord(
    q: Exec<DB>,
    id: EndpointId,
  ): Promise<EndpointRecord | undefined> {
    const res = await sql<
      Record<string, unknown>
    >`select * from endpoints where id = ${id}`.execute(q);
    const row = res.rows[0];
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
    capabilities: isPg ? PG_CAPABILITIES : SQLITE_CAPABILITIES,

    async schemaVersion() {
      await ready();
      const res = await sql<{
        value: string;
      }>`select value from _postel_meta where key = 'schema_version'`.execute(db);
      return res.rows[0]?.value === undefined ? 0 : Number(res.rows[0].value);
    },

    async insertMessage(msg: NewMessage, opts?: HostTxOption<Transaction<DB>>) {
      await ready();
      await insert(exec(opts), "messages", encodeMessageInsert(msg, codec));
      return msg.id;
    },

    async insertOrReuseByIdempotencyKey(
      msg: NewMessage,
      opts?: HostTxOption<Transaction<DB>>,
    ): Promise<InsertOrReuseResult> {
      await ready();
      if (msg.idempotencyKey === null) {
        const id = await this.insertMessage(msg, opts);
        return { id, reused: false };
      }
      return atomic(opts?.tx, async (q) => {
        const existing = await sql<{ id: string }>`select id from messages
          where tenant_id ${distinctOp} ${msg.tenantId} and idempotency_key = ${msg.idempotencyKey}
          limit 1`.execute(q);
        if (existing.rows[0]?.id !== undefined) return { id: existing.rows[0].id, reused: true };
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
      const lock = isPg ? sql`for update skip locked` : sql``;
      const res = await sql<Record<string, unknown>>`update messages
        set reserved_by = ${opts.workerId}, reserved_at = ${now}, lease_expires_at = ${lease},
            attempt_number = attempt_number + 1
        where id in (
          select id from messages
          where status = 'pending' and reserved_by is null
            ${tenantCond}
            and (scheduled_for is null or scheduled_for <= ${now})
          order by coalesce(scheduled_for, created_at), id
          ${lock}
          limit ${opts.batchSize}
        )
        returning *`.execute(db);
      return res.rows.map((row) => decodeReservedMessage(row, codec));
    },

    async recordAttempt(attempt: NewAttempt, opts?: HostTxOption<Transaction<DB>>) {
      await ready();
      await insert(exec(opts), "attempts", encodeAttemptInsert(attempt, codec));
    },

    async renewLease(messageId, workerId, leaseMs, now) {
      const res =
        await sql`update messages set lease_expires_at = ${tsParam(new Date(now.getTime() + leaseMs))}
        where id = ${messageId} and reserved_by = ${workerId}`.execute(db);
      return (res.numAffectedRows ?? 0n) > 0n;
    },

    async releaseLease(messageId, workerId) {
      await sql`update messages set reserved_by = null, reserved_at = null, lease_expires_at = null
        where id = ${messageId} and reserved_by = ${workerId}`.execute(db);
    },

    async expireStaleLeases(now) {
      const res =
        await sql`update messages set reserved_by = null, reserved_at = null, lease_expires_at = null
        where reserved_by is not null and (lease_expires_at is null or lease_expires_at <= ${tsParam(now)})`.execute(
          db,
        );
      return Number(res.numAffectedRows ?? 0n);
    },

    async markMessageFinal(messageId, status) {
      await sql`update messages set status = ${status}, reserved_by = null, reserved_at = null,
        lease_expires_at = null where id = ${messageId}`.execute(db);
    },

    async rescheduleMessage(messageId, opts: RescheduleOpts<Transaction<DB>>) {
      const q = exec(opts);
      const scheduledFor = tsParam(opts.scheduledFor);
      const res =
        opts.replayOf !== undefined
          ? await sql`update messages set scheduled_for = ${scheduledFor}, reserved_by = null,
              reserved_at = null, lease_expires_at = null, status = 'pending', replay_of = ${opts.replayOf}
              where id = ${messageId}`.execute(q)
          : await sql`update messages set scheduled_for = ${scheduledFor}, reserved_by = null,
              reserved_at = null, lease_expires_at = null, status = 'pending' where id = ${messageId}`.execute(
              q,
            );
      return (res.numAffectedRows ?? 0n) > 0n;
    },

    async loadEndpointsForMessage(messageId) {
      await ready();
      const msg = await sql<{
        tenant_id: string | null;
      }>`select tenant_id from messages where id = ${messageId}`.execute(db);
      if (msg.rows.length === 0) return [];
      const tenantId = msg.rows[0]?.tenant_id ?? null;
      const endpointRows = await sql<Record<string, unknown>>`select * from endpoints
        where tenant_id ${distinctOp} ${tenantId} order by created_at, id`.execute(db);
      const out: EndpointWithSecrets[] = [];
      for (const row of endpointRows.rows) {
        const endpoint = attachCallbacks(decodeEndpoint(row, codec), registry);
        const secretRows = await sql<Record<string, unknown>>`select * from endpoint_secrets
          where endpoint_id = ${endpoint.id} order by priority`.execute(db);
        out.push({ endpoint, secrets: secretRows.rows.map((s) => decodeSecret(s, codec)) });
      }
      return out;
    },

    async *rangeQuery(filter: RangeQueryFilter) {
      await ready();
      const conds = [sql`1 = 1`];
      if (filter.tenantId !== undefined) conds.push(sql`tenant_id = ${filter.tenantId}`);
      if (filter.since !== undefined) conds.push(sql`created_at >= ${tsParam(filter.since)}`);
      if (filter.until !== undefined) conds.push(sql`created_at <= ${tsParam(filter.until)}`);
      const where = sql.join(conds, sql` and `);
      const res = await sql<
        Record<string, unknown>
      >`select * from messages where ${where} order by created_at, id`.execute(db);
      for (const row of res.rows) {
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
      const res = await sql<{
        id: string;
      }>`select id, created_at from messages where ${where} order by created_at, id`.execute(db);
      for (const row of res.rows) {
        const last = await sql<{ status: string }>`select status from attempts
          where message_id = ${row.id} and endpoint_id = ${filter.endpointId}
          order by attempt_number desc limit 1`.execute(db);
        if (last.rows.length === 0 || last.rows[0]?.status !== "success") yield row.id as MessageId;
      }
    },

    async countPendingByTenant() {
      await ready();
      const res = await sql<{
        tenant_id: string | null;
        count: number | string | bigint;
      }>`select tenant_id,
        count(*) as count from messages where status = 'pending' group by tenant_id`.execute(db);
      const out = new Map<TenantId | "_null", number>();
      for (const row of res.rows) out.set(row.tenant_id ?? "_null", Number(row.count));
      return out;
    },

    async outboxDepth(opts) {
      await ready();
      const tenantCond =
        opts?.tenantId !== undefined ? sql`and tenant_id = ${opts.tenantId}` : sql``;
      const res = await sql<{
        depth: number | string | bigint;
        oldest: string | Date | null;
      }>`select count(*) as depth,
        min(created_at) as oldest from messages where status = 'pending' ${tenantCond}`.execute(db);
      const row = res.rows[0];
      const oldest = row?.oldest ?? null;
      return {
        depth: Number(row?.depth ?? 0),
        oldestPendingAge: oldest ? clock.now().getTime() - new Date(oldest).getTime() : undefined,
      };
    },

    attempts: {
      async countSince(endpointId, since) {
        const res = await sql<{ status: string }>`select status from attempts
          where endpoint_id = ${endpointId}
            and coalesce(completed_at, started_at, scheduled_for, ${tsParam(since)}) >= ${tsParam(since)}`.execute(
          db,
        );
        let failureCount = 0;
        for (const row of res.rows) if (FAILURE_STATUSES.has(row.status)) failureCount += 1;
        return { count: res.rows.length, failureCount };
      },
      async latestForMessage(messageId) {
        const res = await sql<Record<string, unknown>>`select * from attempts
          where message_id = ${messageId} order by attempt_number`.execute(db);
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
              .map((c) => sql`${sql.ref(c)} = ${bind(row[c])}`),
          );
          await sql`update endpoints set ${assignments} where id = ${id}`.execute(q);
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
          await sql`delete from endpoint_secrets where endpoint_id = ${id}`.execute(q);
          if (opts?.purgeAttempts === true) {
            await sql`delete from attempts where endpoint_id = ${id}`.execute(q);
            await sql`delete from endpoint_state_transitions where endpoint_id = ${id}`.execute(q);
          }
          await sql`delete from endpoints where id = ${id}`.execute(q);
        });
        registry.delete(id);
      },
      async list(opts) {
        await ready();
        const where =
          opts?.tenantId !== undefined ? sql`where tenant_id = ${opts.tenantId}` : sql``;
        const res = await sql<
          Record<string, unknown>
        >`select * from endpoints ${where} order by created_at, id`.execute(db);
        return res.rows.map((row) => attachCallbacks(decodeEndpoint(row, codec), registry));
      },
      async get(id) {
        await ready();
        return loadEndpointRecord(db, id);
      },
      async transitionState(id, to, reason, actor, metadata, opts) {
        return atomic(opts?.tx, async (q) => {
          const prevRes = await sql<{
            state: EndpointState;
          }>`select state from endpoints where id = ${id}`.execute(q);
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
            await sql`update endpoints set state = ${to}, updated_at = ${tsParam(occurredAt)} where id = ${id}`.execute(
              q,
            );
          }
          return transition;
        });
      },
      async listStateTransitions(id) {
        const res = await sql<{
          id: string;
          endpoint_id: string;
          from_state: EndpointState | null;
          to_state: EndpointState | null;
          reason: string;
          actor: string | null;
          metadata: unknown;
          occurred_at: string | Date;
        }>`select * from endpoint_state_transitions where endpoint_id = ${id} order by occurred_at, id`.execute(
          db,
        );
        return res.rows.map((row) => ({
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
        const res = await sql<Record<string, unknown>>`select * from endpoint_secrets
          where endpoint_id = ${endpointId} order by priority`.execute(db);
        return res.rows.map((row) => decodeSecret(row, codec));
      },
      async setStatus(secretId, status, notAfter, opts) {
        await sql`update endpoint_secrets set status = ${status},
          not_after = ${notAfter === null ? null : tsParam(notAfter)} where id = ${secretId}`.execute(
          exec(opts),
        );
      },
      async deleteExpired(now) {
        const res = await sql`delete from endpoint_secrets
          where not_after is not null and not_after <= ${tsParam(now)}`.execute(db);
        return Number(res.numAffectedRows ?? 0n);
      },
    },

    tenants: {
      async upsert(tenantId, metadata, opts) {
        await ready();
        return atomic(opts?.tx, async (q) => {
          const existing = await sql<{
            created_at: string | Date;
          }>`select created_at from tenants where id = ${tenantId}`.execute(q);
          const createdAt = existing.rows[0] ? new Date(existing.rows[0].created_at) : clock.now();
          const metaParam = metadata === null ? null : JSON.stringify(metadata);
          await sql`insert into tenants (id, metadata, created_at) values (${tenantId}, ${metaParam}, ${tsParam(createdAt)})
            on conflict (id) do update set metadata = ${metaParam}`.execute(q);
          const rec: TenantRecord = { id: tenantId, metadata, createdAt };
          return rec;
        });
      },
      async get(tenantId) {
        const res = await sql<{
          id: string;
          metadata: unknown;
          created_at: string | Date;
        }>`select * from tenants where id = ${tenantId}`.execute(db);
        const row = res.rows[0];
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
          const endpointRows = await sql<{
            id: string;
          }>`select id from endpoints where tenant_id = ${tenantId}`.execute(q);
          await sql`delete from endpoint_secrets where endpoint_id in (select id from endpoints where tenant_id = ${tenantId})`.execute(
            q,
          );
          await sql`delete from endpoint_state_transitions where endpoint_id in (select id from endpoints where tenant_id = ${tenantId})`.execute(
            q,
          );
          await sql`delete from attempts where tenant_id = ${tenantId}`.execute(q);
          await sql`delete from messages where tenant_id = ${tenantId}`.execute(q);
          await sql`delete from endpoints where tenant_id = ${tenantId}`.execute(q);
          await sql`delete from tenants where id = ${tenantId}`.execute(q);
          for (const row of endpointRows.rows) registry.delete(row.id);
        });
      },
    },

    async dedup(messageId, opts) {
      await ready();
      const q = exec(opts);
      const nowMs = clock.now();
      const expires = tsParam(new Date(clock.now().getTime() + opts.ttlSeconds * 1000));
      const res = await sql`insert into postel_received_messages (message_id, expires_at)
        values (${messageId}, ${expires})
        on conflict (message_id) do update set expires_at = ${expires}
          where postel_received_messages.expires_at <= ${tsParam(nowMs)}`.execute(q);
      return { duplicate: (res.numAffectedRows ?? 0n) === 0n };
    },

    async transaction<R>(cb: (tx: Transaction<DB>) => Promise<R>): Promise<R> {
      await ready();
      return db.transaction().execute((trx) => cb(trx));
    },

    async notify(channel, payload) {
      if (!isPg) return;
      await sql`select pg_notify(${channel}, ${payload ?? ""})`.execute(db);
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
