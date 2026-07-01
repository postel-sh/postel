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
  decodeTimestamp,
  encodeAttemptInsert,
  encodeEndpointInsert,
  encodeMessageInsert,
  encodeSecretInsert,
} from "@postel/storage-helpers";
import type { DataSource } from "typeorm";

export type TypeOrmDialect = "postgres" | "mysql" | "sqlite";

interface StructuredResult {
  records: unknown[];
  affected?: number;
}

// The raw slice of a TypeORM QueryRunner the adapter calls — non-structured
// `query` returns the driver's rows (SELECT / RETURNING), structured `query`
// returns `{ records, affected }`. This is the handle threaded through
// `HostTxOption`: Postel's `transaction(cb)` hands the callback a QueryRunner.
export interface TypeOrmExecutor {
  query(
    query: string,
    parameters: unknown[] | undefined,
    useStructuredResult: true,
  ): Promise<StructuredResult>;
  query<T = unknown>(query: string, parameters?: unknown[]): Promise<T>;
}

interface TypeOrmQueryRunner extends TypeOrmExecutor {
  connect(): Promise<unknown>;
  release(): Promise<void>;
  startTransaction(isolationLevel?: string): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
}

interface TypeOrmDataSourceLike {
  createQueryRunner(): TypeOrmQueryRunner;
}

export interface TypeOrmStorageOptions {
  // The host's initialized TypeORM `DataSource`. Postel talks to it purely
  // through QueryRunners + raw SQL, so no Postel entities are required.
  readonly dataSource: DataSource;
  readonly dialect: TypeOrmDialect;
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

export function TypeOrmStorage(options: TypeOrmStorageOptions): Storage<TypeOrmExecutor> {
  const ds = options.dataSource as unknown as TypeOrmDataSourceLike;
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
    ex: TypeOrmExecutor,
    sql: string,
    params?: unknown[],
  ): Promise<R[]> {
    return (await ex.query(sql, params)) as R[];
  }

  async function run(ex: TypeOrmExecutor, sql: string, params?: unknown[]): Promise<number> {
    return (await ex.query(sql, params, true)).affected ?? 0;
  }

  // Acquire an executor: the host transaction if present, else a transient
  // QueryRunner released after `fn`.
  async function withExec<R>(
    opts: HostTxOption<TypeOrmExecutor> | undefined,
    fn: (ex: TypeOrmExecutor) => Promise<R>,
  ): Promise<R> {
    if (opts?.tx) return fn(opts.tx);
    const qr = ds.createQueryRunner();
    await qr.connect();
    try {
      return await fn(qr);
    } finally {
      await qr.release();
    }
  }

  // Like withExec but wraps a transaction when no host tx is supplied.
  async function atomic<R>(
    tx: TypeOrmExecutor | undefined,
    fn: (ex: TypeOrmExecutor) => Promise<R>,
  ): Promise<R> {
    if (tx) return fn(tx);
    const qr = ds.createQueryRunner();
    await qr.connect();
    // READ COMMITTED on MySQL: the default REPEATABLE READ gap-locks the range a
    // FOR UPDATE SKIP LOCKED scan touches, making concurrent workers under-reserve.
    await qr.startTransaction(isMysql ? "READ COMMITTED" : undefined);
    try {
      const result = await fn(qr);
      await qr.commitTransaction();
      return result;
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  function insertSql(
    table: string,
    row: Record<string, unknown>,
  ): { text: string; values: unknown[] } {
    const cols = Object.keys(row);
    const p = new Params();
    const placeholders = cols.map((c) => p.add(row[c]));
    return {
      text: `insert into ${ident(table)} (${cols.map(ident).join(", ")}) values (${placeholders.join(", ")})`,
      values: p.values,
    };
  }

  async function insert(
    ex: TypeOrmExecutor,
    table: string,
    row: Record<string, unknown>,
  ): Promise<void> {
    const { text, values } = insertSql(table, row);
    await ex.query(text, values);
  }

  async function loadEndpointRecord(
    ex: TypeOrmExecutor,
    id: EndpointId,
  ): Promise<EndpointRecord | undefined> {
    const res = await rows(ex, `select * from endpoints where id = ${isPg ? "$1" : "?"}`, [id]);
    const row = res[0];
    if (!row) return undefined;
    return attachCallbacks(decodeEndpoint(row, codec), registry);
  }

  async function migrate(): Promise<void> {
    await withExec(undefined, async (ex) => {
      let current = 0;
      try {
        const res = await rows<{ value: string }>(
          ex,
          `select value from _postel_meta where ${metaKey} = 'schema_version'`,
        );
        if (res[0]?.value !== undefined) current = Number(res[0].value);
      } catch {
        current = 0;
      }
      for (const m of isPg ? PG_MIGRATIONS : isMysql ? MYSQL_MIGRATIONS : SQLITE_MIGRATIONS) {
        if (m.version <= current) continue;
        for (const stmt of statements(m.sql)) await ex.query(stmt);
      }
      const dedupDdl = isPg
        ? "create table if not exists postel_received_messages (message_id text primary key, expires_at timestamptz not null)"
        : isMysql
          ? "create table if not exists postel_received_messages (message_id varchar(191) primary key, expires_at bigint not null)"
          : "create table if not exists postel_received_messages (message_id text primary key, expires_at text not null)";
      await ex.query(dedupDdl);
    });
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
      return withExec(undefined, async (ex) => {
        const res = await rows<{ value: string }>(
          ex,
          `select value from _postel_meta where ${metaKey} = 'schema_version'`,
        );
        return res[0]?.value === undefined ? 0 : Number(res[0].value);
      });
    },

    async insertMessage(msg: NewMessage, opts?: HostTxOption<TypeOrmExecutor>) {
      await ready();
      await withExec(opts, (ex) => insert(ex, "messages", encodeMessageInsert(msg, codec)));
      return msg.id;
    },

    async insertOrReuseByIdempotencyKey(
      msg: NewMessage,
      opts?: HostTxOption<TypeOrmExecutor>,
    ): Promise<InsertOrReuseResult> {
      await ready();
      if (msg.idempotencyKey === null) {
        const id = await this.insertMessage(msg, opts);
        return { id, reused: false };
      }
      return atomic(opts?.tx, async (ex) => {
        const p = new Params();
        const text = `select id from messages where tenant_id ${distinctSql} ${p.add(msg.tenantId)} and idempotency_key = ${p.add(msg.idempotencyKey)} limit 1`;
        const existing = await rows<{ id: string }>(ex, text, p.values);
        if (existing[0]?.id !== undefined) return { id: existing[0].id, reused: true };
        await insert(ex, "messages", encodeMessageInsert(msg, codec));
        return { id: msg.id, reused: false };
      });
    },

    async reserveBatch(opts: ReserveBatchOpts): Promise<ReadonlyArray<ReservedMessage>> {
      await ready();
      // MySQL has no RETURNING: lock the due rows, stamp them, read them back in
      // one transaction. Postgres / SQLite do it in a single UPDATE ... RETURNING.
      if (isMysql) {
        return atomic(undefined, async (ex) => {
          const sp = new Params();
          const tenantClause =
            opts.tenantId !== undefined ? `and tenant_id = ${sp.add(opts.tenantId)}` : "";
          const dueAt = sp.add(tsParam(opts.now));
          const limit = sp.add(opts.batchSize);
          const selected = await rows<{ id: string }>(
            ex,
            `select id from messages where status = 'pending' and reserved_by is null ${tenantClause} and (scheduled_for is null or scheduled_for <= ${dueAt}) order by ${reserveOrder} limit ${limit} for update skip locked`,
            sp.values,
          );
          if (selected.length === 0) return [];
          const up = new Params();
          const worker = up.add(opts.workerId);
          const reservedAt = up.add(tsParam(opts.now));
          const lease = up.add(tsParam(new Date(opts.now.getTime() + opts.leaseMs)));
          const updIds = selected.map((r) => up.add(r.id)).join(", ");
          await ex.query(
            `update messages set reserved_by = ${worker}, reserved_at = ${reservedAt}, lease_expires_at = ${lease}, attempt_number = attempt_number + 1 where id in (${updIds})`,
            up.values,
          );
          const rp = new Params();
          const selIds = selected.map((r) => rp.add(r.id)).join(", ");
          const reserved = await rows(
            ex,
            `select * from messages where id in (${selIds}) order by ${reserveOrder}`,
            rp.values,
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
      return withExec(undefined, async (ex) => {
        const reserved = await rows(ex, text, p.values);
        return reserved.map((row) => decodeReservedMessage(row, codec));
      });
    },

    async recordAttempt(attempt: NewAttempt, opts?: HostTxOption<TypeOrmExecutor>) {
      await ready();
      await withExec(opts, (ex) => insert(ex, "attempts", encodeAttemptInsert(attempt, codec)));
    },

    async renewLease(messageId, workerId, leaseMs, now) {
      const p = new Params();
      const text = `update messages set lease_expires_at = ${p.add(tsParam(new Date(now.getTime() + leaseMs)))} where id = ${p.add(messageId)} and reserved_by = ${p.add(workerId)}`;
      return withExec(undefined, async (ex) => (await run(ex, text, p.values)) > 0);
    },

    async releaseLease(messageId, workerId) {
      const p = new Params();
      const text = `update messages set reserved_by = null, reserved_at = null, lease_expires_at = null where id = ${p.add(messageId)} and reserved_by = ${p.add(workerId)}`;
      await withExec(undefined, (ex) => ex.query(text, p.values));
    },

    async expireStaleLeases(now) {
      const p = new Params();
      const text = `update messages set reserved_by = null, reserved_at = null, lease_expires_at = null where reserved_by is not null and (lease_expires_at is null or lease_expires_at <= ${p.add(tsParam(now))})`;
      return withExec(undefined, (ex) => run(ex, text, p.values));
    },

    async markMessageFinal(messageId, status) {
      const p = new Params();
      const text = `update messages set status = ${p.add(status)}, reserved_by = null, reserved_at = null, lease_expires_at = null where id = ${p.add(messageId)}`;
      await withExec(undefined, (ex) => ex.query(text, p.values));
    },

    async rescheduleMessage(messageId, opts: RescheduleOpts<TypeOrmExecutor>) {
      const p = new Params();
      const scheduledFor = p.add(tsParam(opts.scheduledFor));
      const text =
        opts.replayOf !== undefined
          ? `update messages set scheduled_for = ${scheduledFor}, reserved_by = null, reserved_at = null, lease_expires_at = null, status = 'pending', replay_of = ${p.add(opts.replayOf)} where id = ${p.add(messageId)}`
          : `update messages set scheduled_for = ${scheduledFor}, reserved_by = null, reserved_at = null, lease_expires_at = null, status = 'pending' where id = ${p.add(messageId)}`;
      return withExec(opts, async (ex) => (await run(ex, text, p.values)) > 0);
    },

    async loadEndpointsForMessage(messageId) {
      await ready();
      return withExec(undefined, async (ex) => {
        const msg = await rows<{ tenant_id: string | null }>(
          ex,
          `select tenant_id from messages where id = ${isPg ? "$1" : "?"}`,
          [messageId],
        );
        if (msg.length === 0) return [];
        const tenantId = msg[0]?.tenant_id ?? null;
        const ep = new Params();
        const endpointRows = await rows(
          ex,
          `select * from endpoints where tenant_id ${distinctSql} ${ep.add(tenantId)} order by created_at, id`,
          ep.values,
        );
        const out: EndpointWithSecrets[] = [];
        for (const row of endpointRows) {
          const endpoint = attachCallbacks(decodeEndpoint(row, codec), registry);
          const secretRows = await rows(
            ex,
            `select * from endpoint_secrets where endpoint_id = ${isPg ? "$1" : "?"} order by priority`,
            [endpoint.id],
          );
          out.push({ endpoint, secrets: secretRows.map((s) => decodeSecret(s, codec)) });
        }
        return out;
      });
    },

    async getMessage(id, opts) {
      await ready();
      return withExec(opts, async (ex) => {
        const found = await rows<Record<string, unknown>>(
          ex,
          `select * from messages where id = ${isPg ? "$1" : "?"}`,
          [id],
        );
        const row = found[0];
        return row ? decodeStoredMessage(row, codec) : undefined;
      });
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
      const result = await withExec(undefined, (ex) =>
        rows<Record<string, unknown>>(
          ex,
          `select * from messages where ${conds.join(" and ")} order by created_at desc, id desc limit ${limitPlaceholder}`,
          p.values,
        ),
      );
      return result.map((row) => decodeStoredMessage(row, codec));
    },

    async *rangeQuery(filter: RangeQueryFilter) {
      await ready();
      const p = new Params();
      const conds = ["1 = 1"];
      if (filter.tenantId !== undefined) conds.push(`tenant_id = ${p.add(filter.tenantId)}`);
      if (filter.since !== undefined) conds.push(`created_at >= ${p.add(tsParam(filter.since))}`);
      if (filter.until !== undefined) conds.push(`created_at <= ${p.add(tsParam(filter.until))}`);
      const result = await withExec(undefined, (ex) =>
        rows(
          ex,
          `select * from messages where ${conds.join(" and ")} order by created_at, id`,
          p.values,
        ),
      );
      for (const row of result) {
        const message = decodeReservedMessage(row, codec);
        if (filter.types !== undefined && !filter.types.includes(message.type)) continue;
        if (filter.predicate !== undefined && !filter.predicate(message)) continue;
        yield message;
      }
    },

    async *reconcile(filter: ReconcileFilter) {
      await ready();
      // Buffer the unconfirmed ids inside one QueryRunner, then yield — so no
      // runner is held open across suspension points.
      const unconfirmed = await withExec(undefined, async (ex) => {
        const p = new Params();
        const conds = [`created_at >= ${p.add(tsParam(filter.since))}`];
        if (filter.tenantId !== undefined) conds.push(`tenant_id = ${p.add(filter.tenantId)}`);
        const msgRows = await rows<{ id: string }>(
          ex,
          `select id, created_at from messages where ${conds.join(" and ")} order by created_at, id`,
          p.values,
        );
        const out: MessageId[] = [];
        for (const row of msgRows) {
          const lp = new Params();
          const last = await rows<{ status: string }>(
            ex,
            `select status from attempts where message_id = ${lp.add(row.id)} and endpoint_id = ${lp.add(filter.endpointId)} order by attempt_number desc limit 1`,
            lp.values,
          );
          if (last.length === 0 || last[0]?.status !== "success") out.push(row.id as MessageId);
        }
        return out;
      });
      for (const id of unconfirmed) yield id;
    },

    async countPendingByTenant() {
      await ready();
      const res = await withExec(undefined, (ex) =>
        rows<{ tenant_id: string | null; count: number | string | bigint }>(
          ex,
          "select tenant_id, count(*) as count from messages where status = 'pending' group by tenant_id",
        ),
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
      const res = await withExec(undefined, (ex) =>
        rows<{ depth: number | string | bigint; oldest: number | string | Date | null }>(
          ex,
          `select count(*) as depth, min(created_at) as oldest from messages where status = 'pending' ${tenantClause}`,
          p.values,
        ),
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
        const res = await withExec(undefined, (ex) =>
          rows<{ status: string }>(
            ex,
            `select status from attempts where endpoint_id = ${endpointPh} and coalesce(completed_at, started_at, scheduled_for, ${since1}) >= ${since2}`,
            p.values,
          ),
        );
        let failureCount = 0;
        for (const row of res) if (FAILURE_STATUSES.has(row.status)) failureCount += 1;
        return { count: res.length, failureCount };
      },
      async latestForMessage(messageId) {
        const res = await withExec(undefined, (ex) =>
          rows(
            ex,
            `select * from attempts where message_id = ${isPg ? "$1" : "?"} order by attempt_number`,
            [messageId],
          ),
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
        await withExec(opts, (ex) => insert(ex, "endpoints", encodeEndpointInsert(full, codec)));
        registry.set(full.id, { filter: full.filter, transform: full.transform });
        return full;
      },
      async update(id, patch, opts) {
        return atomic(opts?.tx, async (ex) => {
          const prev = await loadEndpointRecord(ex, id);
          if (!prev) throw new Error(`endpoint not found: ${id}`);
          const next: EndpointRecord = { ...prev, ...patch, id: prev.id, updatedAt: clock.now() };
          const row = encodeEndpointInsert(next, codec);
          const p = new Params();
          const assignments = Object.keys(row)
            .filter((c) => c !== "id" && c !== "created_at")
            .map((c) => `${ident(c)} = ${p.add(row[c])}`)
            .join(", ");
          await ex.query(`update endpoints set ${assignments} where id = ${p.add(id)}`, p.values);
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
        await atomic(opts?.tx, async (ex) => {
          const ph = isPg ? "$1" : "?";
          await ex.query(`delete from endpoint_secrets where endpoint_id = ${ph}`, [id]);
          if (opts?.purgeAttempts === true) {
            await ex.query(`delete from attempts where endpoint_id = ${ph}`, [id]);
            await ex.query(`delete from endpoint_state_transitions where endpoint_id = ${ph}`, [
              id,
            ]);
          }
          await ex.query(`delete from endpoints where id = ${ph}`, [id]);
        });
        registry.delete(id);
      },
      async list(opts) {
        await ready();
        const res = await withExec(undefined, (ex) => {
          if (opts?.tenantId !== undefined) {
            return rows(
              ex,
              `select * from endpoints where tenant_id = ${isPg ? "$1" : "?"} order by created_at, id`,
              [opts.tenantId],
            );
          }
          return rows(ex, "select * from endpoints order by created_at, id");
        });
        return res.map((row) => attachCallbacks(decodeEndpoint(row, codec), registry));
      },
      async get(id) {
        await ready();
        return withExec(undefined, (ex) => loadEndpointRecord(ex, id));
      },
      async transitionState(id, to, reason, actor, metadata, opts) {
        return atomic(opts?.tx, async (ex) => {
          const prev = await rows<{ state: EndpointState }>(
            ex,
            `select state from endpoints where id = ${isPg ? "$1" : "?"}`,
            [id],
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
            await insert(ex, "endpoint_state_transitions", {
              id: transitionId,
              endpoint_id: id,
              from_state: prev[0].state,
              to_state: to,
              reason,
              actor,
              metadata: metadata === undefined ? null : JSON.stringify(metadata),
              occurred_at: tsParam(occurredAt),
            });
            const up = new Params();
            await ex.query(
              `update endpoints set state = ${up.add(to)}, updated_at = ${up.add(tsParam(occurredAt))} where id = ${up.add(id)}`,
              up.values,
            );
          }
          return transition;
        });
      },
      async listStateTransitions(id) {
        const res = await withExec(undefined, (ex) =>
          rows<{
            id: string;
            endpoint_id: string;
            from_state: EndpointState | null;
            to_state: EndpointState | null;
            reason: string;
            actor: string | null;
            metadata: unknown;
            occurred_at: number | string | Date;
          }>(
            ex,
            `select * from endpoint_state_transitions where endpoint_id = ${isPg ? "$1" : "?"} order by occurred_at, id`,
            [id],
          ),
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
        await withExec(opts, (ex) =>
          insert(ex, "endpoint_secrets", {
            ...encodeSecretInsert(rec, codec),
            created_at: tsParam(full.createdAt),
          }),
        );
        return full;
      },
      async listForEndpoint(endpointId) {
        const res = await withExec(undefined, (ex) =>
          rows(
            ex,
            `select * from endpoint_secrets where endpoint_id = ${isPg ? "$1" : "?"} order by priority`,
            [endpointId],
          ),
        );
        return res.map((row) => decodeSecret(row, codec));
      },
      async setStatus(secretId, status, notAfter, opts) {
        const p = new Params();
        const text = `update endpoint_secrets set status = ${p.add(status)}, not_after = ${p.add(notAfter === null ? null : tsParam(notAfter))} where id = ${p.add(secretId)}`;
        await withExec(opts, (ex) => ex.query(text, p.values));
      },
      async deleteExpired(now) {
        const p = new Params();
        const text = `delete from endpoint_secrets where not_after is not null and not_after <= ${p.add(tsParam(now))}`;
        return withExec(undefined, (ex) => run(ex, text, p.values));
      },
    },

    tenants: {
      async upsert(tenantId, metadata, opts) {
        await ready();
        return atomic(opts?.tx, async (ex) => {
          const existing = await rows<{ created_at: number | string | Date }>(
            ex,
            `select created_at from tenants where id = ${isPg ? "$1" : "?"}`,
            [tenantId],
          );
          const createdAt = decodeTimestamp(existing[0]?.created_at ?? null, codec) ?? clock.now();
          const metaParam = metadata === null ? null : JSON.stringify(metadata);
          const p = new Params();
          const idP = p.add(tenantId);
          const metaP = p.add(metaParam);
          const atP = p.add(tsParam(createdAt));
          // MySQL re-uses the inserted value via VALUES(); PG/SQLite re-bind it.
          const conflict = isMysql
            ? "on duplicate key update metadata = values(metadata)"
            : `on conflict (id) do update set metadata = ${p.add(metaParam)}`;
          await ex.query(
            `insert into tenants (id, metadata, created_at) values (${idP}, ${metaP}, ${atP}) ${conflict}`,
            p.values,
          );
          const rec: TenantRecord = { id: tenantId, metadata, createdAt };
          return rec;
        });
      },
      async get(tenantId) {
        const res = await withExec(undefined, (ex) =>
          rows<{ id: string; metadata: unknown; created_at: number | string | Date }>(
            ex,
            `select * from tenants where id = ${isPg ? "$1" : "?"}`,
            [tenantId],
          ),
        );
        const row = res[0];
        if (!row) return undefined;
        const metadata =
          row.metadata === null || row.metadata === undefined
            ? null
            : typeof row.metadata === "string"
              ? (JSON.parse(row.metadata) as Record<string, unknown>)
              : (row.metadata as Record<string, unknown>);
        return {
          id: row.id,
          metadata,
          createdAt: decodeTimestamp(row.created_at, codec) ?? new Date(0),
        };
      },
      async delete(tenantId, opts) {
        await atomic(opts?.tx, async (ex) => {
          const ph = isPg ? "$1" : "?";
          const endpointRows = await rows<{ id: string }>(
            ex,
            `select id from endpoints where tenant_id = ${ph}`,
            [tenantId],
          );
          const sub = `(select id from endpoints where tenant_id = ${ph})`;
          await ex.query(`delete from endpoint_secrets where endpoint_id in ${sub}`, [tenantId]);
          await ex.query(`delete from endpoint_state_transitions where endpoint_id in ${sub}`, [
            tenantId,
          ]);
          await ex.query(`delete from attempts where tenant_id = ${ph}`, [tenantId]);
          await ex.query(`delete from messages where tenant_id = ${ph}`, [tenantId]);
          await ex.query(`delete from endpoints where tenant_id = ${ph}`, [tenantId]);
          await ex.query(`delete from tenants where id = ${ph}`, [tenantId]);
          for (const row of endpointRows) registry.delete(row.id);
        });
      },
    },

    async dedup(messageId, opts) {
      await ready();
      const expiresDate = new Date(clock.now().getTime() + opts.ttlSeconds * 1000);
      return withExec(opts, async (ex) => {
        const p = new Params();
        if (isMysql) {
          // INSERT IGNORE has a clean affected count (1 inserted / 0 duplicate);
          // ON DUPLICATE KEY UPDATE can't distinguish a no-op refresh from a dup.
          const ip = new Params();
          const insSql = `insert ignore into postel_received_messages (message_id, expires_at) values (${ip.add(messageId)}, ${ip.add(tsParam(expiresDate))})`;
          if ((await run(ex, insSql, ip.values)) > 0) return { duplicate: false };
          const up = new Params();
          const updSql = `update postel_received_messages set expires_at = ${up.add(tsParam(expiresDate))} where message_id = ${up.add(messageId)} and expires_at <= ${up.add(tsParam(clock.now()))}`;
          return { duplicate: (await run(ex, updSql, up.values)) === 0 };
        }
        const idP = p.add(messageId);
        const expires1 = p.add(tsParam(expiresDate));
        const expires2 = p.add(tsParam(expiresDate));
        const nowP = p.add(tsParam(clock.now()));
        const sql = `insert into postel_received_messages (message_id, expires_at) values (${idP}, ${expires1}) on conflict (message_id) do update set expires_at = ${expires2} where postel_received_messages.expires_at <= ${nowP}`;
        return { duplicate: (await run(ex, sql, p.values)) === 0 };
      });
    },

    async transaction<R>(cb: (tx: TypeOrmExecutor) => Promise<R>): Promise<R> {
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
