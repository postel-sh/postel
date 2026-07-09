import type { EntityManager, MikroORM } from "@mikro-orm/core";
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
  DEFAULT_ENDPOINT_LIST_LIMIT,
  DEFAULT_MESSAGE_LIST_LIMIT,
  DEFAULT_RECONCILE_LIMIT,
  DEFAULT_TENANT_LIST_LIMIT,
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
  decodeKeysetCursor,
  decodeReservedMessage,
  decodeSecret,
  decodeStoredMessage,
  decodeTenant,
  decodeTenantCursor,
  decodeTimestamp,
  encodeAttemptInsert,
  encodeEndpointInsert,
  encodeMessageInsert,
  encodeSecretInsert,
  encodeTenantCursor,
  pageFromRows,
} from "@postel/storage-helpers";

export type MikroOrmDialect = "postgres" | "mysql" | "sqlite";

// A MikroORM transaction context (knex `Transaction`), opaque to the caller —
// the handle Postel threads through `HostTxOption` and passes back to execute().
export type MikroOrmTransaction = unknown;

// The structural slice of a MikroORM `Connection` the adapter calls: `execute`
// with `'all'` returns rows (SELECT / RETURNING), `'run'` returns a QueryResult
// carrying `affectedRows`. A real MikroORM connection satisfies it.
interface MikroConnection {
  execute<T = unknown>(
    query: string,
    params?: unknown[],
    method?: "all" | "get" | "run",
    ctx?: MikroOrmTransaction,
  ): Promise<T>;
  transactional<T>(
    cb: (trx: MikroOrmTransaction) => Promise<T>,
    options?: { isolationLevel?: string },
  ): Promise<T>;
}

export interface MikroOrmStorageOptions {
  // Your MikroORM instance, or its EntityManager. Postel talks to the underlying
  // connection with raw SQL, so no Postel entities are required.
  readonly orm?: MikroORM;
  readonly em?: EntityManager;
  readonly dialect: MikroOrmDialect;
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

const FAILURE_STATUSES = new Set([
  "failed",
  "failed-permanent",
  "dead-letter",
  "ssrf-blocked",
  "expired",
]);

export function MikroOrmStorage(options: MikroOrmStorageOptions): Storage<MikroOrmTransaction> {
  const baseEm = options.orm?.em ?? options.em;
  if (!baseEm) throw new Error("MikroOrmStorage requires either an `orm` or an `em`");
  const conn = baseEm.getConnection() as unknown as MikroConnection;
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
  // `key` is reserved in MySQL; the other dialects accept it unquoted.
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
    return isPg ? date : isMysql ? date.getTime() : date.toISOString();
  }

  // Placeholder dialect: Postgres `$1..`, MySQL/SQLite positional `?`.
  class Params {
    readonly values: unknown[] = [];
    add(value: unknown): string {
      this.values.push(normalize(value));
      return isPg ? `$${this.values.length}` : "?";
    }
  }

  function ident(name: string): string {
    return isMysql ? `\`${name}\`` : `"${name}"`;
  }

  async function rows<R = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
    ctx?: MikroOrmTransaction,
  ): Promise<R[]> {
    return (await conn.execute<R[]>(sql, params, "all", ctx)) ?? [];
  }

  async function run(sql: string, params?: unknown[], ctx?: MikroOrmTransaction): Promise<number> {
    const res = await conn.execute<{ affectedRows?: number }>(sql, params, "run", ctx);
    return res?.affectedRows ?? 0;
  }

  async function atomic<R>(
    tx: MikroOrmTransaction | undefined,
    fn: (ctx: MikroOrmTransaction) => Promise<R>,
  ): Promise<R> {
    if (tx !== undefined) return fn(tx);
    // READ COMMITTED on MySQL: the default REPEATABLE READ gap-locks the range a
    // FOR UPDATE SKIP LOCKED scan touches, making concurrent workers under-reserve.
    return isMysql
      ? conn.transactional((trx) => fn(trx), { isolationLevel: "read committed" })
      : conn.transactional((trx) => fn(trx));
  }

  async function insert(
    table: string,
    row: Record<string, unknown>,
    ctx?: MikroOrmTransaction,
  ): Promise<void> {
    const cols = Object.keys(row);
    const p = new Params();
    const placeholders = cols.map((c) => p.add(row[c]));
    await run(
      `insert into ${ident(table)} (${cols.map(ident).join(", ")}) values (${placeholders.join(", ")})`,
      p.values,
      ctx,
    );
  }

  async function loadEndpointRecord(
    id: EndpointId,
    ctx?: MikroOrmTransaction,
  ): Promise<EndpointRecord | undefined> {
    const res = await rows(`select * from endpoints where id = ${isPg ? "$1" : "?"}`, [id], ctx);
    const row = res[0];
    if (!row) return undefined;
    return attachCallbacks(decodeEndpoint(row, codec), registry);
  }

  async function migrate(): Promise<void> {
    let current = 0;
    try {
      const res = await rows<{ value: string }>(
        `select value from _postel_meta where ${metaKey} = 'schema_version'`,
      );
      if (res[0]?.value !== undefined) current = Number(res[0].value);
    } catch {
      current = 0;
    }
    for (const m of isPg ? PG_MIGRATIONS : isMysql ? MYSQL_MIGRATIONS : SQLITE_MIGRATIONS) {
      if (m.version <= current) continue;
      for (const stmt of statements(m.sql)) await conn.execute(stmt);
    }
    const dedupDdl = isPg
      ? "create table if not exists postel_received_messages (message_id text primary key, expires_at timestamptz not null)"
      : isMysql
        ? "create table if not exists postel_received_messages (message_id varchar(191) primary key, expires_at bigint not null)"
        : "create table if not exists postel_received_messages (message_id text primary key, expires_at text not null)";
    await conn.execute(dedupDdl);
    migrated = true;
  }

  async function ready(): Promise<void> {
    if (options.autoMigrate === false || migrated) return;
    await migrate();
  }

  return {
    capabilities: isPg ? PG_CAPABILITIES : isMysql ? MYSQL_CAPABILITIES : SQLITE_CAPABILITIES,

    async schemaVersion() {
      await ready();
      const res = await rows<{ value: string }>(
        `select value from _postel_meta where ${metaKey} = 'schema_version'`,
      );
      return res[0]?.value === undefined ? 0 : Number(res[0].value);
    },

    async insertMessage(msg: NewMessage, opts?: HostTxOption<MikroOrmTransaction>) {
      await ready();
      await insert("messages", encodeMessageInsert(msg, codec), opts?.tx);
      return msg.id;
    },

    async insertOrReuseByIdempotencyKey(
      msg: NewMessage,
      opts?: HostTxOption<MikroOrmTransaction>,
    ): Promise<InsertOrReuseResult> {
      await ready();
      if (msg.idempotencyKey === null) {
        const id = await this.insertMessage(msg, opts);
        return { id, reused: false };
      }
      return atomic(opts?.tx, async (ctx) => {
        const p = new Params();
        const text = `select id from messages where tenant_id ${distinctSql} ${p.add(msg.tenantId)} and idempotency_key = ${p.add(msg.idempotencyKey)} limit 1`;
        const existing = await rows<{ id: string }>(text, p.values, ctx);
        if (existing[0]?.id !== undefined) return { id: existing[0].id, reused: true };
        await insert("messages", encodeMessageInsert(msg, codec), ctx);
        return { id: msg.id, reused: false };
      });
    },

    async reserveBatch(opts: ReserveBatchOpts): Promise<ReadonlyArray<ReservedMessage>> {
      await ready();
      // MySQL has no RETURNING: lock the due rows, stamp, read back in one
      // transaction. Postgres / SQLite use a single UPDATE ... RETURNING.
      if (isMysql) {
        return atomic(undefined, async (ctx) => {
          const sp = new Params();
          const tenantClause =
            opts.tenantId !== undefined ? `and tenant_id = ${sp.add(opts.tenantId)}` : "";
          const dueAt = sp.add(tsParam(opts.now));
          const limit = sp.add(opts.batchSize);
          const selected = await rows<{ id: string }>(
            `select id from messages where status = 'pending' and reserved_by is null ${tenantClause} and (scheduled_for is null or scheduled_for <= ${dueAt}) order by ${reserveOrder} limit ${limit} for update skip locked`,
            sp.values,
            ctx,
          );
          if (selected.length === 0) return [];
          const up = new Params();
          const worker = up.add(opts.workerId);
          const reservedAt = up.add(tsParam(opts.now));
          const lease = up.add(tsParam(new Date(opts.now.getTime() + opts.leaseMs)));
          const updIds = selected.map((r) => up.add(r.id)).join(", ");
          await run(
            `update messages set reserved_by = ${worker}, reserved_at = ${reservedAt}, lease_expires_at = ${lease}, attempt_number = attempt_number + 1 where id in (${updIds})`,
            up.values,
            ctx,
          );
          const rp = new Params();
          const selIds = selected.map((r) => rp.add(r.id)).join(", ");
          const reserved = await rows(
            `select * from messages where id in (${selIds}) order by ${reserveOrder}`,
            rp.values,
            ctx,
          );
          return reserved.map((row) => decodeReservedMessage(row, codec));
        });
      }
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
      const reserved = await rows(text, p.values);
      return reserved.map((row) => decodeReservedMessage(row, codec));
    },

    async recordAttempt(attempt: NewAttempt, opts?: HostTxOption<MikroOrmTransaction>) {
      await ready();
      await insert("attempts", encodeAttemptInsert(attempt, codec), opts?.tx);
    },

    async renewLease(messageId, workerId, leaseMs, now) {
      const p = new Params();
      const text = `update messages set lease_expires_at = ${p.add(tsParam(new Date(now.getTime() + leaseMs)))} where id = ${p.add(messageId)} and reserved_by = ${p.add(workerId)}`;
      return (await run(text, p.values)) > 0;
    },

    async releaseLease(messageId, workerId) {
      const p = new Params();
      const text = `update messages set reserved_by = null, reserved_at = null, lease_expires_at = null where id = ${p.add(messageId)} and reserved_by = ${p.add(workerId)}`;
      await run(text, p.values);
    },

    async expireStaleLeases(now) {
      const p = new Params();
      const text = `update messages set reserved_by = null, reserved_at = null, lease_expires_at = null where reserved_by is not null and (lease_expires_at is null or lease_expires_at <= ${p.add(tsParam(now))})`;
      return run(text, p.values);
    },

    async markMessageFinal(messageId, status) {
      const p = new Params();
      const text = `update messages set status = ${p.add(status)}, reserved_by = null, reserved_at = null, lease_expires_at = null where id = ${p.add(messageId)}`;
      await run(text, p.values);
    },

    async rescheduleMessage(messageId, opts: RescheduleOpts<MikroOrmTransaction>) {
      const p = new Params();
      const scheduledFor = p.add(tsParam(opts.scheduledFor));
      const text =
        opts.replayOf !== undefined
          ? `update messages set scheduled_for = ${scheduledFor}, reserved_by = null, reserved_at = null, lease_expires_at = null, status = 'pending', replay_of = ${p.add(opts.replayOf)} where id = ${p.add(messageId)}`
          : `update messages set scheduled_for = ${scheduledFor}, reserved_by = null, reserved_at = null, lease_expires_at = null, status = 'pending' where id = ${p.add(messageId)}`;
      return (await run(text, p.values, opts.tx)) > 0;
    },

    async loadEndpointsForMessage(messageId) {
      await ready();
      const msg = await rows<{ tenant_id: string | null }>(
        `select tenant_id from messages where id = ${isPg ? "$1" : "?"}`,
        [messageId],
      );
      if (msg.length === 0) return [];
      const tenantId = msg[0]?.tenant_id ?? null;
      const ep = new Params();
      const endpointRows = await rows(
        `select * from endpoints where tenant_id ${distinctSql} ${ep.add(tenantId)} order by created_at, id`,
        ep.values,
      );
      const out: EndpointWithSecrets[] = [];
      for (const row of endpointRows) {
        const endpoint = attachCallbacks(decodeEndpoint(row, codec), registry);
        const secretRows = await rows(
          `select * from endpoint_secrets where endpoint_id = ${isPg ? "$1" : "?"} order by priority`,
          [endpoint.id],
        );
        out.push({ endpoint, secrets: secretRows.map((s) => decodeSecret(s, codec)) });
      }
      return out;
    },

    async getMessage(id, opts) {
      await ready();
      const found = await rows<Record<string, unknown>>(
        `select * from messages where id = ${isPg ? "$1" : "?"}`,
        [id],
        opts?.tx,
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
      if (filter.cursor !== undefined) {
        const { createdAt, id } = decodeKeysetCursor(filter.cursor);
        const ts1 = p.add(tsParam(createdAt));
        const ts2 = p.add(tsParam(createdAt));
        conds.push(`(created_at < ${ts1} or (created_at = ${ts2} and id < ${p.add(id)}))`);
      }
      const limit = filter.limit ?? DEFAULT_MESSAGE_LIST_LIMIT;
      const limitPlaceholder = p.add(limit + 1);
      const result = await rows<Record<string, unknown>>(
        `select * from messages where ${conds.join(" and ")} order by created_at desc, id desc limit ${limitPlaceholder}`,
        p.values,
      );
      return pageFromRows(
        result.map((row) => decodeStoredMessage(row, codec)),
        limit,
      );
    },

    async *rangeQuery(filter: RangeQueryFilter) {
      await ready();
      const p = new Params();
      const conds = ["1 = 1"];
      if (filter.tenantId !== undefined) conds.push(`tenant_id = ${p.add(filter.tenantId)}`);
      if (filter.since !== undefined) conds.push(`created_at >= ${p.add(tsParam(filter.since))}`);
      if (filter.until !== undefined) conds.push(`created_at <= ${p.add(tsParam(filter.until))}`);
      const result = await rows(
        `select * from messages where ${conds.join(" and ")} order by created_at, id`,
        p.values,
      );
      for (const row of result) {
        const message = decodeReservedMessage(row, codec);
        if (filter.types !== undefined && !filter.types.includes(message.type)) continue;
        if (filter.predicate !== undefined && !filter.predicate(message)) continue;
        yield message;
      }
    },

    // One bounded query: candidates are messages with no delivered-latest
    // attempt for the endpoint, keyset-continued and LIMITed in SQL — a
    // recurring reconcile job never scans the whole since-range.
    async reconcile(filter: ReconcileFilter) {
      await ready();
      const limit = filter.limit ?? DEFAULT_RECONCILE_LIMIT;
      const p = new Params();
      const conds = [`m.created_at >= ${p.add(tsParam(filter.since))}`];
      if (filter.tenantId !== undefined) conds.push(`m.tenant_id = ${p.add(filter.tenantId)}`);
      if (filter.cursor !== undefined) {
        const { createdAt, id } = decodeKeysetCursor(filter.cursor);
        const ts1 = p.add(tsParam(createdAt));
        const ts2 = p.add(tsParam(createdAt));
        conds.push(`(m.created_at > ${ts1} or (m.created_at = ${ts2} and m.id > ${p.add(id)}))`);
      }
      const ep = p.add(filter.endpointId);
      const limitPlaceholder = p.add(limit + 1);
      const msgRows = await rows<{ id: string; created_at: unknown }>(
        `select m.id, m.created_at from messages m
         where ${conds.join(" and ")}
           and not exists (
             select 1 from attempts a
             where a.message_id = m.id and a.endpoint_id = ${ep} and a.status = 'success'
               and a.attempt_number = (
                 select max(a2.attempt_number) from attempts a2
                 where a2.message_id = m.id and a2.endpoint_id = a.endpoint_id
               )
           )
         order by m.created_at, m.id limit ${limitPlaceholder}`,
        p.values,
      );
      const candidates = msgRows.map((row) => ({
        id: row.id as MessageId,
        createdAt: decodeTimestamp(row.created_at, codec) ?? new Date(0),
      }));
      const page = pageFromRows(candidates, limit);
      return { items: page.items.map((c) => c.id), nextCursor: page.nextCursor };
    },

    async countPendingByTenant() {
      await ready();
      const res = await rows<{ tenant_id: string | null; count: number | string | bigint }>(
        "select tenant_id, count(*) as count from messages where status = 'pending' group by tenant_id",
      );
      const out = new Map<TenantId | "_null", number>();
      for (const row of res) out.set(row.tenant_id ?? "_null", Number(row.count));
      return out;
    },

    async outboxDepth(opts) {
      await ready();
      const p = new Params();
      const tenantClause =
        opts?.tenantId !== undefined ? `and tenant_id = ${p.add(opts.tenantId)}` : "";
      const res = await rows<{
        depth: number | string | bigint;
        oldest: number | string | Date | null;
      }>(
        `select count(*) as depth, min(created_at) as oldest from messages where status = 'pending' ${tenantClause}`,
        p.values,
      );
      const row = res[0];
      const oldest = decodeTimestamp(row?.oldest ?? null, codec);
      return {
        depth: Number(row?.depth ?? 0),
        oldestPendingAge: oldest ? clock.now().getTime() - oldest.getTime() : undefined,
      };
    },

    attempts: {
      async countSince(endpointId, since) {
        const p = new Params();
        const endpointPh = p.add(endpointId);
        const since1 = p.add(tsParam(since));
        const since2 = p.add(tsParam(since));
        const res = await rows<{ status: string }>(
          `select status from attempts where endpoint_id = ${endpointPh} and coalesce(completed_at, started_at, scheduled_for, ${since1}) >= ${since2}`,
          p.values,
        );
        let failureCount = 0;
        for (const row of res) if (FAILURE_STATUSES.has(row.status)) failureCount += 1;
        return { count: res.length, failureCount };
      },
      async latestForMessage(messageId) {
        const res = await rows(
          `select * from attempts where message_id = ${isPg ? "$1" : "?"} order by attempt_number`,
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
          filterFn: rec.filterFn ?? null,
          transform: rec.transform ?? null,
          createdAt: now,
          updatedAt: now,
        };
        await insert("endpoints", encodeEndpointInsert(full, codec), opts?.tx);
        registry.set(full.id, { filterFn: full.filterFn, transform: full.transform });
        return full;
      },
      async update(id, patch, opts) {
        return atomic(opts?.tx, async (ctx) => {
          const prev = await loadEndpointRecord(id, ctx);
          if (!prev) throw new Error(`endpoint not found: ${id}`);
          const next: EndpointRecord = { ...prev, ...patch, id: prev.id, updatedAt: clock.now() };
          const row = encodeEndpointInsert(next, codec);
          const p = new Params();
          const assignments = Object.keys(row)
            .filter((c) => c !== "id" && c !== "created_at")
            .map((c) => `${ident(c)} = ${p.add(row[c])}`)
            .join(", ");
          await run(`update endpoints set ${assignments} where id = ${p.add(id)}`, p.values, ctx);
          if ("filterFn" in patch || "transform" in patch) {
            registry.applyPatch(id, {
              ...("filterFn" in patch ? { filterFn: patch.filterFn ?? null } : {}),
              ...("transform" in patch ? { transform: patch.transform ?? null } : {}),
            });
          }
          return attachCallbacks(next, registry);
        });
      },
      async delete(id, opts) {
        await atomic(opts?.tx, async (ctx) => {
          const ph = isPg ? "$1" : "?";
          await run(`delete from endpoint_secrets where endpoint_id = ${ph}`, [id], ctx);
          if (opts?.purgeAttempts === true) {
            await run(`delete from attempts where endpoint_id = ${ph}`, [id], ctx);
            await run(
              `delete from endpoint_state_transitions where endpoint_id = ${ph}`,
              [id],
              ctx,
            );
          }
          await run(`delete from endpoints where id = ${ph}`, [id], ctx);
        });
        registry.delete(id);
      },
      async list(opts) {
        await ready();
        const p = new Params();
        const conds = ["1 = 1"];
        if (opts?.tenantId !== undefined) conds.push(`tenant_id = ${p.add(opts.tenantId)}`);
        if (opts?.cursor !== undefined) {
          const { createdAt, id } = decodeKeysetCursor(opts.cursor);
          const ts1 = p.add(tsParam(createdAt));
          const ts2 = p.add(tsParam(createdAt));
          conds.push(`(created_at < ${ts1} or (created_at = ${ts2} and id < ${p.add(id)}))`);
        }
        const limit = opts?.limit ?? DEFAULT_ENDPOINT_LIST_LIMIT;
        const limitPlaceholder = p.add(limit + 1);
        const res = await rows<Record<string, unknown>>(
          `select * from endpoints where ${conds.join(" and ")} order by created_at desc, id desc limit ${limitPlaceholder}`,
          p.values,
        );
        return pageFromRows(
          res.map((row) => attachCallbacks(decodeEndpoint(row, codec), registry)),
          limit,
        );
      },
      async get(id) {
        await ready();
        return loadEndpointRecord(id);
      },
      async transitionState(id, to, reason, actor, metadata, opts) {
        return atomic(opts?.tx, async (ctx) => {
          const prev = await rows<{ state: EndpointState }>(
            `select state from endpoints where id = ${isPg ? "$1" : "?"}`,
            [id],
            ctx,
          );
          if (!prev[0]) throw new Error(`endpoint not found: ${id}`);
          const transitionId = `trans_${cryptoId()}`;
          const occurredAt = clock.now();
          const transition: EndpointStateTransition = {
            id: transitionId,
            endpointId: id,
            fromState: prev[0].state,
            toState: to,
            reason,
            actor,
            metadata: metadata ?? null,
            occurredAt,
          };
          if (to !== null) {
            await insert(
              "endpoint_state_transitions",
              {
                id: transitionId,
                endpoint_id: id,
                from_state: prev[0].state,
                to_state: to,
                reason,
                actor,
                metadata: metadata === undefined ? null : JSON.stringify(metadata),
                occurred_at: tsParam(occurredAt),
              },
              ctx,
            );
            const up = new Params();
            await run(
              `update endpoints set state = ${up.add(to)}, updated_at = ${up.add(tsParam(occurredAt))} where id = ${up.add(id)}`,
              up.values,
              ctx,
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
          occurred_at: number | string | Date;
        }>(
          `select * from endpoint_state_transitions where endpoint_id = ${isPg ? "$1" : "?"} order by occurred_at, id`,
          [id],
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
          occurredAt: decodeTimestamp(row.occurred_at, codec) ?? new Date(0),
        }));
      },
    },

    secrets: {
      async insert(rec, opts) {
        await ready();
        const full: EndpointSecretRecord = { ...rec, createdAt: clock.now() };
        await insert(
          "endpoint_secrets",
          { ...encodeSecretInsert(rec, codec), created_at: tsParam(full.createdAt) },
          opts?.tx,
        );
        return full;
      },
      async listForEndpoint(endpointId) {
        const res = await rows(
          `select * from endpoint_secrets where endpoint_id = ${isPg ? "$1" : "?"} order by priority`,
          [endpointId],
        );
        return res.map((row) => decodeSecret(row, codec));
      },
      async setStatus(secretId, status, notAfter, opts) {
        const p = new Params();
        const text = `update endpoint_secrets set status = ${p.add(status)}, not_after = ${p.add(notAfter === null ? null : tsParam(notAfter))} where id = ${p.add(secretId)}`;
        await run(text, p.values, opts?.tx);
      },
      async deleteExpired(now) {
        const p = new Params();
        const text = `delete from endpoint_secrets where not_after is not null and not_after <= ${p.add(tsParam(now))}`;
        return run(text, p.values);
      },
    },

    tenants: {
      async upsert(tenantId, metadata, opts) {
        await ready();
        return atomic(opts?.tx, async (ctx) => {
          const existing = await rows<{ created_at: number | string | Date }>(
            `select created_at from tenants where id = ${isPg ? "$1" : "?"}`,
            [tenantId],
            ctx,
          );
          const createdAt = decodeTimestamp(existing[0]?.created_at ?? null, codec) ?? clock.now();
          const metaParam = metadata === null ? null : JSON.stringify(metadata);
          const p = new Params();
          const idP = p.add(tenantId);
          const metaP = p.add(metaParam);
          const atP = p.add(tsParam(createdAt));
          const conflict = isMysql
            ? "on duplicate key update metadata = values(metadata)"
            : `on conflict (id) do update set metadata = ${p.add(metaParam)}`;
          await run(
            `insert into tenants (id, metadata, created_at) values (${idP}, ${metaP}, ${atP}) ${conflict}`,
            p.values,
            ctx,
          );
          const rec: TenantRecord = { id: tenantId, metadata, createdAt };
          return rec;
        });
      },
      async get(tenantId, opts) {
        await ready();
        const res = await rows<Record<string, unknown>>(
          `select * from tenants where id = ${isPg ? "$1" : "?"}`,
          [tenantId],
          opts?.tx,
        );
        const row = res[0];
        return row ? decodeTenant(row, codec) : undefined;
      },
      async list(filter: TenantListFilter) {
        await ready();
        const p = new Params();
        const conds = ["1 = 1"];
        if (filter.cursor !== undefined) {
          const { createdAt, id } = decodeTenantCursor(filter.cursor);
          const c1 = p.add(tsParam(createdAt));
          const c2 = p.add(tsParam(createdAt));
          const idP = p.add(id);
          conds.push(`(created_at < ${c1} or (created_at = ${c2} and id < ${idP}))`);
        }
        const limit = filter.limit ?? DEFAULT_TENANT_LIST_LIMIT;
        const limitPlaceholder = p.add(limit + 1);
        const res = await rows<Record<string, unknown>>(
          `select * from tenants where ${conds.join(" and ")} order by created_at desc, id desc limit ${limitPlaceholder}`,
          p.values,
        );
        const decoded = res.map((row) => decodeTenant(row, codec));
        const items = decoded.slice(0, limit);
        const last = items[items.length - 1];
        const nextCursor = decoded.length > limit && last ? encodeTenantCursor(last) : null;
        return { items, nextCursor };
      },
      async delete(tenantId, opts) {
        await atomic(opts?.tx, async (ctx) => {
          const ph = isPg ? "$1" : "?";
          const endpointRows = await rows<{ id: string }>(
            `select id from endpoints where tenant_id = ${ph}`,
            [tenantId],
            ctx,
          );
          const sub = `(select id from endpoints where tenant_id = ${ph})`;
          await run(`delete from endpoint_secrets where endpoint_id in ${sub}`, [tenantId], ctx);
          await run(
            `delete from endpoint_state_transitions where endpoint_id in ${sub}`,
            [tenantId],
            ctx,
          );
          await run(`delete from attempts where tenant_id = ${ph}`, [tenantId], ctx);
          await run(`delete from messages where tenant_id = ${ph}`, [tenantId], ctx);
          await run(`delete from endpoints where tenant_id = ${ph}`, [tenantId], ctx);
          await run(`delete from tenants where id = ${ph}`, [tenantId], ctx);
          for (const row of endpointRows) registry.delete(row.id);
        });
      },
    },

    async dedup(messageId, opts) {
      await ready();
      const expiresDate = new Date(clock.now().getTime() + opts.ttlSeconds * 1000);
      const p = new Params();
      if (isMysql) {
        // INSERT IGNORE has a clean affectedRows (1 inserted / 0 duplicate);
        // ON DUPLICATE KEY UPDATE can't distinguish a no-op refresh from a dup.
        const ip = new Params();
        const insSql = `insert ignore into postel_received_messages (message_id, expires_at) values (${ip.add(messageId)}, ${ip.add(tsParam(expiresDate))})`;
        if ((await run(insSql, ip.values, opts.tx)) > 0) return { duplicate: false };
        const up = new Params();
        const updSql = `update postel_received_messages set expires_at = ${up.add(tsParam(expiresDate))} where message_id = ${up.add(messageId)} and expires_at <= ${up.add(tsParam(clock.now()))}`;
        return { duplicate: (await run(updSql, up.values, opts.tx)) === 0 };
      }
      const idP = p.add(messageId);
      const expires1 = p.add(tsParam(expiresDate));
      const expires2 = p.add(tsParam(expiresDate));
      const nowP = p.add(tsParam(clock.now()));
      const sql = `insert into postel_received_messages (message_id, expires_at) values (${idP}, ${expires1}) on conflict (message_id) do update set expires_at = ${expires2} where postel_received_messages.expires_at <= ${nowP}`;
      return { duplicate: (await run(sql, p.values, opts.tx)) === 0 };
    },

    async transaction<R>(cb: (tx: MikroOrmTransaction) => Promise<R>): Promise<R> {
      await ready();
      return atomic(undefined, cb);
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
