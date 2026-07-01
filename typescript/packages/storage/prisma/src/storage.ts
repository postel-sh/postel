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
import type { PrismaClient } from "@prisma/client";

export type PrismaDialect = "postgres" | "mysql" | "sqlite";

// The raw slice of a PrismaClient the adapter calls, and the handle it threads
// through `HostTxOption`. Every generated client — and the interactive
// transaction client — exposes these regardless of which models you declare.
export interface PrismaLike {
  $queryRawUnsafe<R = unknown>(query: string, ...values: unknown[]): Promise<R[]>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $transaction<R>(
    fn: (tx: PrismaLike) => Promise<R>,
    options?: { isolationLevel?: string },
  ): Promise<R>;
}

export interface PrismaStorageOptions {
  /**
   * Your `PrismaClient`. Postel talks to it purely through the raw query surface
   * (`$queryRawUnsafe` / `$executeRawUnsafe` / `$transaction`), so no Postel
   * models are required in your `schema.prisma`.
   */
  readonly prisma: PrismaClient;
  readonly dialect: PrismaDialect;
  readonly clock?: Clock;
  readonly autoMigrate?: boolean;
}

const PG_CODEC: ColumnCodec = { time: "native", json: "text" };

function quote(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function statements(migrationSql: string): string[] {
  return migrationSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function PrismaStorage(options: PrismaStorageOptions): Storage<PrismaLike> {
  const prisma = options.prisma as unknown as PrismaLike;
  const { dialect } = options;
  const isPg = dialect === "postgres";
  const isMysql = dialect === "mysql";
  // MySQL: order by the indexed created_at (the (status, created_at) index) so the
  // FOR UPDATE SKIP LOCKED scan streams instead of filesorting — a FOR UPDATE
  // filesort locks every examined row, starving concurrent workers.
  const reserveOrder = isMysql ? "created_at, id" : "coalesce(scheduled_for, created_at), id";
  const codec = isPg ? PG_CODEC : isMysql ? MYSQL_CODEC : SQLITE_CODEC;
  // Null-safe equality: Postgres IS NOT DISTINCT FROM; MySQL <=>; SQLite IS.
  const distinctSql = isPg ? "is not distinct from" : isMysql ? "<=>" : "is";
  // `key` is a reserved word in MySQL; the other dialects accept it unquoted.
  const metaKey = isMysql ? "`key`" : "key";
  const clock: Clock = options.clock ?? { now: () => new Date(), sleep: async () => {} };
  const registry = createCallbackRegistry();
  let migrated = false;

  function normalize(value: unknown): unknown {
    if (value === undefined) return null;
    if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value);
    if (!isPg && typeof value === "boolean") return value ? 1 : 0;
    return value;
  }

  function tsParam(date: Date): unknown {
    // MySQL stores epoch-ms BIGINT; SQLite ISO-8601 text; Postgres native Date.
    return isPg ? date : isMysql ? date.getTime() : date.toISOString();
  }

  // Accumulates bind values and emits the dialect's placeholder ($1.. / ?).
  class Params {
    readonly values: unknown[] = [];
    add(value: unknown): string {
      this.values.push(normalize(value));
      return isPg ? `$${this.values.length}` : "?";
    }
  }

  function exec(opts?: HostTxOption<PrismaLike>): PrismaLike {
    return opts?.tx ?? prisma;
  }

  async function atomic<R>(
    tx: PrismaLike | undefined,
    fn: (q: PrismaLike) => Promise<R>,
  ): Promise<R> {
    if (tx) return fn(tx);
    // READ COMMITTED on MySQL avoids the REPEATABLE READ gap locks that break the
    // FOR UPDATE SKIP LOCKED queue partition.
    return isMysql
      ? prisma.$transaction((trx) => fn(trx), { isolationLevel: "ReadCommitted" })
      : prisma.$transaction((trx) => fn(trx));
  }

  async function migrate(): Promise<void> {
    let current = 0;
    try {
      const res = await prisma.$queryRawUnsafe<{ value: string }>(
        `select value from _postel_meta where ${metaKey} = 'schema_version'`,
      );
      if (res[0]?.value !== undefined) current = Number(res[0].value);
    } catch {
      current = 0;
    }
    for (const m of isPg ? PG_MIGRATIONS : isMysql ? MYSQL_MIGRATIONS : SQLITE_MIGRATIONS) {
      if (m.version <= current) continue;
      for (const stmt of statements(m.sql)) await prisma.$executeRawUnsafe(stmt);
    }
    const dedupDdl = isPg
      ? "create table if not exists postel_received_messages (message_id text primary key, expires_at timestamptz not null)"
      : isMysql
        ? "create table if not exists postel_received_messages (message_id varchar(191) primary key, expires_at bigint not null)"
        : "create table if not exists postel_received_messages (message_id text primary key, expires_at text not null)";
    await prisma.$executeRawUnsafe(dedupDdl);
    migrated = true;
  }

  async function ready(): Promise<void> {
    if (options.autoMigrate === false || migrated) return;
    await migrate();
  }

  function insertSql(
    table: string,
    row: Record<string, unknown>,
  ): { text: string; values: unknown[] } {
    const cols = Object.keys(row);
    const p = new Params();
    const placeholders = cols.map((c) => p.add(row[c]));
    return {
      text: `insert into ${quote(table)} (${cols.map(quote).join(", ")}) values (${placeholders.join(", ")})`,
      values: p.values,
    };
  }

  async function insert(
    on: PrismaLike,
    table: string,
    row: Record<string, unknown>,
  ): Promise<void> {
    const { text, values } = insertSql(table, row);
    await on.$executeRawUnsafe(text, ...values);
  }

  async function loadEndpointRecord(
    on: PrismaLike,
    id: EndpointId,
  ): Promise<EndpointRecord | undefined> {
    const rows = await on.$queryRawUnsafe<Record<string, unknown>>(
      `select * from endpoints where id = ${isPg ? "$1" : "?"}`,
      id,
    );
    const row = rows[0];
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
      const rows = await prisma.$queryRawUnsafe<{ value: string }>(
        `select value from _postel_meta where ${metaKey} = 'schema_version'`,
      );
      return rows[0]?.value === undefined ? 0 : Number(rows[0].value);
    },

    async insertMessage(msg: NewMessage, opts?: HostTxOption<PrismaLike>) {
      await ready();
      await insert(exec(opts), "messages", encodeMessageInsert(msg, codec));
      return msg.id;
    },

    async insertOrReuseByIdempotencyKey(
      msg: NewMessage,
      opts?: HostTxOption<PrismaLike>,
    ): Promise<InsertOrReuseResult> {
      await ready();
      if (msg.idempotencyKey === null) {
        const id = await this.insertMessage(msg, opts);
        return { id, reused: false };
      }
      return atomic(opts?.tx, async (q) => {
        const p = new Params();
        const text = `select id from messages where tenant_id ${distinctSql} ${p.add(msg.tenantId)} and idempotency_key = ${p.add(msg.idempotencyKey)} limit 1`;
        const existing = await q.$queryRawUnsafe<{ id: string }>(text, ...p.values);
        if (existing[0]?.id !== undefined) return { id: existing[0].id, reused: true };
        await insert(q, "messages", encodeMessageInsert(msg, codec));
        return { id: msg.id, reused: false };
      });
    },

    async reserveBatch(opts: ReserveBatchOpts): Promise<ReadonlyArray<ReservedMessage>> {
      await ready();
      // MySQL has no RETURNING: lock due rows (FOR UPDATE SKIP LOCKED), stamp
      // them, then read them back inside one interactive transaction.
      if (isMysql) {
        return atomic(undefined, async (q) => {
          const sp = new Params();
          const tenantClause =
            opts.tenantId !== undefined ? `and tenant_id = ${sp.add(opts.tenantId)}` : "";
          const dueAt = sp.add(tsParam(opts.now));
          const limit = sp.add(opts.batchSize);
          const selected = await q.$queryRawUnsafe<{ id: string }>(
            `select id from messages where status = 'pending' and reserved_by is null ${tenantClause} and (scheduled_for is null or scheduled_for <= ${dueAt}) order by ${reserveOrder} limit ${limit} for update skip locked`,
            ...sp.values,
          );
          if (selected.length === 0) return [];
          const up = new Params();
          const worker = up.add(opts.workerId);
          const reservedAt = up.add(tsParam(opts.now));
          const lease = up.add(tsParam(new Date(opts.now.getTime() + opts.leaseMs)));
          const updIds = selected.map((r) => up.add(r.id)).join(", ");
          await q.$executeRawUnsafe(
            `update messages set reserved_by = ${worker}, reserved_at = ${reservedAt}, lease_expires_at = ${lease}, attempt_number = attempt_number + 1 where id in (${updIds})`,
            ...up.values,
          );
          const rp = new Params();
          const selIds = selected.map((r) => rp.add(r.id)).join(", ");
          const reserved = await q.$queryRawUnsafe<Record<string, unknown>>(
            `select * from messages where id in (${selIds}) order by ${reserveOrder}`,
            ...rp.values,
          );
          return reserved.map((row) => decodeReservedMessage(row, codec));
        });
      }
      // Add one param per placeholder occurrence, in left-to-right SQL order:
      // SQLite uses positional `?`, so a value can't be referenced twice.
      const p = new Params();
      const worker = p.add(opts.workerId);
      const reservedAt = p.add(tsParam(opts.now));
      const lease = p.add(tsParam(new Date(opts.now.getTime() + opts.leaseMs)));
      const tenantClause =
        opts.tenantId !== undefined ? `and tenant_id = ${p.add(opts.tenantId)}` : "";
      const dueAt = p.add(tsParam(opts.now));
      const limit = p.add(opts.batchSize);
      const lock = isPg ? "for update skip locked" : "";
      const text = `update messages
        set reserved_by = ${worker}, reserved_at = ${reservedAt}, lease_expires_at = ${lease},
            attempt_number = attempt_number + 1
        where id in (
          select id from messages
          where status = 'pending' and reserved_by is null
            ${tenantClause}
            and (scheduled_for is null or scheduled_for <= ${dueAt})
          order by ${reserveOrder}
          ${lock}
          limit ${limit}
        )
        returning *`;
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>>(text, ...p.values);
      return rows.map((row) => decodeReservedMessage(row, codec));
    },

    async recordAttempt(attempt: NewAttempt, opts?: HostTxOption<PrismaLike>) {
      await ready();
      await insert(exec(opts), "attempts", encodeAttemptInsert(attempt, codec));
    },

    async renewLease(messageId, workerId, leaseMs, now) {
      const p = new Params();
      const text = `update messages set lease_expires_at = ${p.add(tsParam(new Date(now.getTime() + leaseMs)))} where id = ${p.add(messageId)} and reserved_by = ${p.add(workerId)}`;
      return (await prisma.$executeRawUnsafe(text, ...p.values)) > 0;
    },

    async releaseLease(messageId, workerId) {
      const p = new Params();
      const text = `update messages set reserved_by = null, reserved_at = null, lease_expires_at = null where id = ${p.add(messageId)} and reserved_by = ${p.add(workerId)}`;
      await prisma.$executeRawUnsafe(text, ...p.values);
    },

    async expireStaleLeases(now) {
      const p = new Params();
      const text = `update messages set reserved_by = null, reserved_at = null, lease_expires_at = null where reserved_by is not null and (lease_expires_at is null or lease_expires_at <= ${p.add(tsParam(now))})`;
      return prisma.$executeRawUnsafe(text, ...p.values);
    },

    async markMessageFinal(messageId, status) {
      const p = new Params();
      const text = `update messages set status = ${p.add(status)}, reserved_by = null, reserved_at = null, lease_expires_at = null where id = ${p.add(messageId)}`;
      await prisma.$executeRawUnsafe(text, ...p.values);
    },

    async rescheduleMessage(messageId, opts: RescheduleOpts<PrismaLike>) {
      const q = exec(opts);
      const p = new Params();
      const scheduledFor = p.add(tsParam(opts.scheduledFor));
      const text =
        opts.replayOf !== undefined
          ? `update messages set scheduled_for = ${scheduledFor}, reserved_by = null, reserved_at = null, lease_expires_at = null, status = 'pending', replay_of = ${p.add(opts.replayOf)} where id = ${p.add(messageId)}`
          : `update messages set scheduled_for = ${scheduledFor}, reserved_by = null, reserved_at = null, lease_expires_at = null, status = 'pending' where id = ${p.add(messageId)}`;
      return (await q.$executeRawUnsafe(text, ...p.values)) > 0;
    },

    async loadEndpointsForMessage(messageId) {
      await ready();
      const msg = await prisma.$queryRawUnsafe<{ tenant_id: string | null }>(
        `select tenant_id from messages where id = ${isPg ? "$1" : "?"}`,
        messageId,
      );
      if (msg.length === 0) return [];
      const tenantId = msg[0]?.tenant_id ?? null;
      const ep = new Params();
      const endpointRows = await prisma.$queryRawUnsafe<Record<string, unknown>>(
        `select * from endpoints where tenant_id ${distinctSql} ${ep.add(tenantId)} order by created_at, id`,
        ...ep.values,
      );
      const out: EndpointWithSecrets[] = [];
      for (const row of endpointRows) {
        const endpoint = attachCallbacks(decodeEndpoint(row, codec), registry);
        const secretRows = await prisma.$queryRawUnsafe<Record<string, unknown>>(
          `select * from endpoint_secrets where endpoint_id = ${isPg ? "$1" : "?"} order by priority`,
          endpoint.id,
        );
        out.push({ endpoint, secrets: secretRows.map((s) => decodeSecret(s, codec)) });
      }
      return out;
    },

    async getMessage(id, opts) {
      await ready();
      const found = await exec(opts).$queryRawUnsafe<Record<string, unknown>>(
        `select * from messages where id = ${isPg ? "$1" : "?"}`,
        id,
      );
      const row = found[0];
      return row ? decodeStoredMessage(row, codec) : undefined;
    },

    async listMessages(filter: MessageListFilter) {
      await ready();
      const p = new Params();
      const conds = ["1 = 1"];
      if (filter.tenantId !== undefined) conds.push(`tenant_id = ${p.add(filter.tenantId)}`);
      if (filter.since !== undefined) conds.push(`created_at >= ${p.add(tsParam(filter.since))}`);
      if (filter.until !== undefined) conds.push(`created_at <= ${p.add(tsParam(filter.until))}`);
      if (filter.types !== undefined && filter.types.length > 0) {
        conds.push(`type in (${filter.types.map((t) => p.add(t)).join(", ")})`);
      }
      if (filter.status !== undefined && filter.status.length > 0) {
        conds.push(`status in (${filter.status.map((s) => p.add(s)).join(", ")})`);
      }
      const limitPlaceholder = p.add(filter.limit ?? DEFAULT_MESSAGE_LIST_LIMIT);
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>>(
        `select * from messages where ${conds.join(" and ")} order by created_at desc, id desc limit ${limitPlaceholder}`,
        ...p.values,
      );
      return rows.map((row) => decodeStoredMessage(row, codec));
    },

    async *rangeQuery(filter: RangeQueryFilter) {
      await ready();
      const p = new Params();
      const conds = ["1 = 1"];
      if (filter.tenantId !== undefined) conds.push(`tenant_id = ${p.add(filter.tenantId)}`);
      if (filter.since !== undefined) conds.push(`created_at >= ${p.add(tsParam(filter.since))}`);
      if (filter.until !== undefined) conds.push(`created_at <= ${p.add(tsParam(filter.until))}`);
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>>(
        `select * from messages where ${conds.join(" and ")} order by created_at, id`,
        ...p.values,
      );
      for (const row of rows) {
        const message = decodeReservedMessage(row, codec);
        if (filter.types !== undefined && !filter.types.includes(message.type)) continue;
        if (filter.predicate !== undefined && !filter.predicate(message)) continue;
        yield message;
      }
    },

    async *reconcile(filter: ReconcileFilter) {
      await ready();
      const p = new Params();
      const conds = [`created_at >= ${p.add(tsParam(filter.since))}`];
      if (filter.tenantId !== undefined) conds.push(`tenant_id = ${p.add(filter.tenantId)}`);
      const rows = await prisma.$queryRawUnsafe<{ id: string }>(
        `select id, created_at from messages where ${conds.join(" and ")} order by created_at, id`,
        ...p.values,
      );
      for (const row of rows) {
        const lp = new Params();
        const last = await prisma.$queryRawUnsafe<{ status: string }>(
          `select status from attempts where message_id = ${lp.add(row.id)} and endpoint_id = ${lp.add(filter.endpointId)} order by attempt_number desc limit 1`,
          ...lp.values,
        );
        if (last.length === 0 || last[0]?.status !== "success") yield row.id as MessageId;
      }
    },

    async countPendingByTenant() {
      await ready();
      const rows = await prisma.$queryRawUnsafe<{
        tenant_id: string | null;
        count: number | string | bigint;
      }>(
        "select tenant_id, count(*) as count from messages where status = 'pending' group by tenant_id",
      );
      const out = new Map<TenantId | "_null", number>();
      for (const row of rows) out.set(row.tenant_id ?? "_null", Number(row.count));
      return out;
    },

    async outboxDepth(opts) {
      await ready();
      const p = new Params();
      const tenantClause =
        opts?.tenantId !== undefined ? `and tenant_id = ${p.add(opts.tenantId)}` : "";
      const rows = await prisma.$queryRawUnsafe<{
        depth: number | string | bigint;
        oldest: string | Date | null;
      }>(
        `select count(*) as depth, min(created_at) as oldest from messages where status = 'pending' ${tenantClause}`,
        ...p.values,
      );
      const row = rows[0];
      const oldest = row?.oldest ?? null;
      return {
        depth: Number(row?.depth ?? 0),
        oldestPendingAge: oldest ? clock.now().getTime() - new Date(oldest).getTime() : undefined,
      };
    },

    attempts: {
      async countSince(endpointId, since) {
        const p = new Params();
        const endpointPh = p.add(endpointId);
        const since1 = p.add(tsParam(since));
        const since2 = p.add(tsParam(since));
        const rows = await prisma.$queryRawUnsafe<{ status: string }>(
          `select status from attempts where endpoint_id = ${endpointPh} and coalesce(completed_at, started_at, scheduled_for, ${since1}) >= ${since2}`,
          ...p.values,
        );
        let failureCount = 0;
        for (const row of rows) if (FAILURE_STATUSES.has(row.status)) failureCount += 1;
        return { count: rows.length, failureCount };
      },
      async latestForMessage(messageId) {
        const rows = await prisma.$queryRawUnsafe<Record<string, unknown>>(
          `select * from attempts where message_id = ${isPg ? "$1" : "?"} order by attempt_number`,
          messageId,
        );
        return rows.map((row) => decodeAttempt(row, codec));
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
          const p = new Params();
          const assignments = Object.keys(row)
            .filter((c) => c !== "id" && c !== "created_at")
            .map((c) => `${quote(c)} = ${p.add(row[c])}`);
          const text = `update endpoints set ${assignments.join(", ")} where id = ${p.add(id)}`;
          await q.$executeRawUnsafe(text, ...p.values);
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
          const idPh = isPg ? "$1" : "?";
          await q.$executeRawUnsafe(`delete from endpoint_secrets where endpoint_id = ${idPh}`, id);
          if (opts?.purgeAttempts === true) {
            await q.$executeRawUnsafe(`delete from attempts where endpoint_id = ${idPh}`, id);
            await q.$executeRawUnsafe(
              `delete from endpoint_state_transitions where endpoint_id = ${idPh}`,
              id,
            );
          }
          await q.$executeRawUnsafe(`delete from endpoints where id = ${idPh}`, id);
        });
        registry.delete(id);
      },
      async list(opts) {
        await ready();
        const p = new Params();
        const where =
          opts?.tenantId !== undefined ? `where tenant_id = ${p.add(opts.tenantId)}` : "";
        const rows = await prisma.$queryRawUnsafe<Record<string, unknown>>(
          `select * from endpoints ${where} order by created_at, id`,
          ...p.values,
        );
        return rows.map((row) => attachCallbacks(decodeEndpoint(row, codec), registry));
      },
      async get(id) {
        await ready();
        return loadEndpointRecord(prisma, id);
      },
      async transitionState(id, to, reason, actor, metadata, opts) {
        return atomic(opts?.tx, async (q) => {
          const prevRows = await q.$queryRawUnsafe<{ state: EndpointState }>(
            `select state from endpoints where id = ${isPg ? "$1" : "?"}`,
            id,
          );
          const prev = prevRows[0];
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
            const p = new Params();
            await q.$executeRawUnsafe(
              `update endpoints set state = ${p.add(to)}, updated_at = ${p.add(tsParam(occurredAt))} where id = ${p.add(id)}`,
              ...p.values,
            );
          }
          return transition;
        });
      },
      async listStateTransitions(id) {
        const rows = await prisma.$queryRawUnsafe<{
          id: string;
          endpoint_id: string;
          from_state: EndpointState | null;
          to_state: EndpointState | null;
          reason: string;
          actor: string | null;
          metadata: unknown;
          occurred_at: string | Date;
        }>(
          `select * from endpoint_state_transitions where endpoint_id = ${isPg ? "$1" : "?"} order by occurred_at, id`,
          id,
        );
        return rows.map((row) => ({
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
        const rows = await prisma.$queryRawUnsafe<Record<string, unknown>>(
          `select * from endpoint_secrets where endpoint_id = ${isPg ? "$1" : "?"} order by priority`,
          endpointId,
        );
        return rows.map((row) => decodeSecret(row, codec));
      },
      async setStatus(secretId, status, notAfter, opts) {
        const p = new Params();
        const text = `update endpoint_secrets set status = ${p.add(status)}, not_after = ${p.add(notAfter === null ? null : tsParam(notAfter))} where id = ${p.add(secretId)}`;
        await exec(opts).$executeRawUnsafe(text, ...p.values);
      },
      async deleteExpired(now) {
        const p = new Params();
        const text = `delete from endpoint_secrets where not_after is not null and not_after <= ${p.add(tsParam(now))}`;
        return prisma.$executeRawUnsafe(text, ...p.values);
      },
    },

    tenants: {
      async upsert(tenantId, metadata, opts) {
        await ready();
        return atomic(opts?.tx, async (q) => {
          const existing = await q.$queryRawUnsafe<{ created_at: string | Date }>(
            `select created_at from tenants where id = ${isPg ? "$1" : "?"}`,
            tenantId,
          );
          const createdAt = existing[0] ? new Date(existing[0].created_at) : clock.now();
          const metaParam = metadata === null ? null : JSON.stringify(metadata);
          const p = new Params();
          const idP = p.add(tenantId);
          const meta1 = p.add(metaParam);
          const createdP = p.add(tsParam(createdAt));
          const meta2 = p.add(metaParam);
          await q.$executeRawUnsafe(
            `insert into tenants (id, metadata, created_at) values (${idP}, ${meta1}, ${createdP}) on conflict (id) do update set metadata = ${meta2}`,
            ...p.values,
          );
          const rec: TenantRecord = { id: tenantId, metadata, createdAt };
          return rec;
        });
      },
      async get(tenantId) {
        const rows = await prisma.$queryRawUnsafe<{
          id: string;
          metadata: unknown;
          created_at: string | Date;
        }>(`select * from tenants where id = ${isPg ? "$1" : "?"}`, tenantId);
        const row = rows[0];
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
          const endpointRows = await q.$queryRawUnsafe<{ id: string }>(
            `select id from endpoints where tenant_id = ${isPg ? "$1" : "?"}`,
            tenantId,
          );
          const sub = isPg
            ? "(select id from endpoints where tenant_id = $1)"
            : "(select id from endpoints where tenant_id = ?)";
          await q.$executeRawUnsafe(
            `delete from endpoint_secrets where endpoint_id in ${sub}`,
            tenantId,
          );
          await q.$executeRawUnsafe(
            `delete from endpoint_state_transitions where endpoint_id in ${sub}`,
            tenantId,
          );
          const idPh = isPg ? "$1" : "?";
          await q.$executeRawUnsafe(`delete from attempts where tenant_id = ${idPh}`, tenantId);
          await q.$executeRawUnsafe(`delete from messages where tenant_id = ${idPh}`, tenantId);
          await q.$executeRawUnsafe(`delete from endpoints where tenant_id = ${idPh}`, tenantId);
          await q.$executeRawUnsafe(`delete from tenants where id = ${idPh}`, tenantId);
          for (const row of endpointRows) registry.delete(row.id);
        });
      },
    },

    async dedup(messageId, opts) {
      await ready();
      const q = exec(opts);
      const expiresDate = new Date(clock.now().getTime() + opts.ttlSeconds * 1000);
      // INSERT IGNORE has a clean affected count (1 inserted / 0 duplicate);
      // MySQL's ON DUPLICATE KEY UPDATE can't distinguish a no-op refresh from a
      // live duplicate.
      if (isMysql) {
        const ip = new Params();
        const insSql = `insert ignore into postel_received_messages (message_id, expires_at) values (${ip.add(messageId)}, ${ip.add(tsParam(expiresDate))})`;
        const inserted = await q.$executeRawUnsafe(insSql, ...ip.values);
        if (inserted > 0) return { duplicate: false };
        const up = new Params();
        const updSql = `update postel_received_messages set expires_at = ${up.add(tsParam(expiresDate))} where message_id = ${up.add(messageId)} and expires_at <= ${up.add(tsParam(clock.now()))}`;
        const refreshed = await q.$executeRawUnsafe(updSql, ...up.values);
        return { duplicate: refreshed === 0 };
      }
      const p = new Params();
      const idP = p.add(messageId);
      const expires1 = p.add(tsParam(expiresDate));
      const expires2 = p.add(tsParam(expiresDate));
      const nowP = p.add(tsParam(clock.now()));
      const text = `insert into postel_received_messages (message_id, expires_at) values (${idP}, ${expires1}) on conflict (message_id) do update set expires_at = ${expires2} where postel_received_messages.expires_at <= ${nowP}`;
      const changes = await q.$executeRawUnsafe(text, ...p.values);
      return { duplicate: changes === 0 };
    },

    async transaction<R>(cb: (tx: PrismaLike) => Promise<R>): Promise<R> {
      await ready();
      return prisma.$transaction(cb);
    },

    async notify(channel, payload) {
      if (!isPg) return;
      await prisma.$executeRawUnsafe("select pg_notify($1, $2)", channel, payload ?? "");
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
