import { type Clock, systemClock } from "../../clock.js";
import type {
  AttemptId,
  AttemptStatsResult,
  EndpointId,
  EndpointRecord,
  EndpointSecretRecord,
  EndpointSecretStatus,
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
  SecretAlgorithm,
  Storage,
  StorageCapabilities,
  TenantId,
  TenantRecord,
  Unsubscribe,
  WorkerId,
} from "../types.js";
import { AsyncMutex } from "./mutex.js";
import { type InMemoryTx, createTx, isInMemoryTx } from "./tx.js";

export interface InMemoryStorageOptions {
  readonly clock?: Clock;
}

interface MessageRow {
  id: MessageId;
  tenantId: TenantId | null;
  type: string;
  data: unknown;
  channels: ReadonlyArray<string> | null;
  idempotencyKey: string | null;
  version: string | null;
  ttlSeconds: number | null;
  createdAt: Date;
  expiresAt: Date | null;
  reservedBy: WorkerId | null;
  reservedAt: Date | null;
  leaseExpiresAt: Date | null;
  status: "pending" | "dispatched" | "expired";
  attemptNumber: number;
  scheduledFor: Date | null;
  replayOf: MessageId | null;
}

interface DedupRow {
  messageId: string;
  expiresAt: Date;
}

const CAPABILITIES: StorageCapabilities = {
  notify: true,
  subscribe: true,
  transactional: true,
  streaming: true,
};

const SCHEMA_VERSION = 1;

function newId(prefix: string): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return `${prefix}_${s}`;
}

export function InMemoryStorage(options: InMemoryStorageOptions = {}): Storage<InMemoryTx> {
  const clock: Clock = options.clock ?? systemClock;

  const messages = new Map<MessageId, MessageRow>();
  const idempotencyIndex = new Map<string, MessageId>();
  const attempts = new Map<AttemptId, NewAttempt>();
  const endpoints = new Map<EndpointId, EndpointRecord>();
  const secrets = new Map<string, EndpointSecretRecord>();
  const stateTransitions = new Map<string, EndpointStateTransition>();
  const tenants = new Map<TenantId, TenantRecord>();
  const dedupRows = new Map<string, DedupRow>();
  const listeners = new Map<string, Set<(payload: string) => void>>();

  const writeLock = new AsyncMutex();

  function inTx<R>(opts: HostTxOption | undefined, fn: () => R): R {
    const tx = opts?.tx;
    if (tx === undefined) return fn();
    if (!isInMemoryTx(tx) || !tx.active) {
      throw new Error("InMemoryStorage received an unsupported tx handle");
    }
    return fn();
  }

  function recordRollback(opts: HostTxOption | undefined, undo: () => void): void {
    const tx = opts?.tx;
    if (tx === undefined) return;
    if (isInMemoryTx(tx) && tx.active) tx.rollbacks.push(undo);
  }

  function recordPostCommit(opts: HostTxOption | undefined, hook: () => void): void {
    const tx = opts?.tx;
    if (tx === undefined) {
      hook();
      return;
    }
    if (isInMemoryTx(tx) && tx.active) tx.postCommit.push(hook);
  }

  function idempotencyKey(tenantId: TenantId | null, key: string | null): string | undefined {
    if (key === null) return undefined;
    return `${tenantId ?? ""}|${key}`;
  }

  function notifyChannel(channel: string, payload: string): void {
    const ls = listeners.get(channel);
    if (!ls || ls.size === 0) return;
    queueMicrotask(() => {
      for (const handler of ls) handler(payload);
    });
  }

  function asReserved(row: MessageRow, leaseExpiresAt: Date): ReservedMessage {
    return {
      id: row.id,
      tenantId: row.tenantId,
      type: row.type,
      data: row.data,
      channels: row.channels,
      version: row.version,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      leaseExpiresAt,
      attemptNumber: row.attemptNumber,
      scheduledFor: row.scheduledFor,
      replayOf: row.replayOf,
    };
  }

  function sortPendingForReservation(rows: MessageRow[]): MessageRow[] {
    return rows.sort((a, b) => {
      const aTime = (a.scheduledFor ?? a.createdAt).getTime();
      const bTime = (b.scheduledFor ?? b.createdAt).getTime();
      if (aTime !== bTime) return aTime - bTime;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  return {
    capabilities: CAPABILITIES,

    async schemaVersion() {
      return SCHEMA_VERSION;
    },

    async insertMessage(msg: NewMessage, opts) {
      const row: MessageRow = {
        id: msg.id,
        tenantId: msg.tenantId,
        type: msg.type,
        data: msg.data,
        channels: msg.channels,
        idempotencyKey: msg.idempotencyKey,
        version: msg.version,
        ttlSeconds: msg.ttlSeconds,
        createdAt: msg.createdAt,
        expiresAt: msg.expiresAt,
        reservedBy: null,
        reservedAt: null,
        leaseExpiresAt: null,
        status: "pending",
        attemptNumber: 0,
        scheduledFor: null,
        replayOf: msg.replayOf ?? null,
      };
      return writeLock.run(async () => {
        inTx(opts, () => {
          messages.set(row.id, row);
          const key = idempotencyKey(row.tenantId, row.idempotencyKey);
          if (key !== undefined) idempotencyIndex.set(key, row.id);
          recordRollback(opts, () => {
            messages.delete(row.id);
            if (key !== undefined) idempotencyIndex.delete(key);
          });
        });
        recordPostCommit(opts, () => {
          notifyChannel("postel_messages_new", `${row.tenantId ?? ""}|${row.id}`);
        });
        return row.id;
      });
    },

    async insertOrReuseByIdempotencyKey(msg: NewMessage, opts): Promise<InsertOrReuseResult> {
      if (msg.idempotencyKey === null) {
        const id = await this.insertMessage(msg, opts);
        return { id, reused: false };
      }
      return writeLock.run(async () => {
        const key = `${msg.tenantId ?? ""}|${msg.idempotencyKey}`;
        const existing = idempotencyIndex.get(key);
        if (existing !== undefined) return { id: existing, reused: true };
        const row: MessageRow = {
          id: msg.id,
          tenantId: msg.tenantId,
          type: msg.type,
          data: msg.data,
          channels: msg.channels,
          idempotencyKey: msg.idempotencyKey,
          version: msg.version,
          ttlSeconds: msg.ttlSeconds,
          createdAt: msg.createdAt,
          expiresAt: msg.expiresAt,
          reservedBy: null,
          reservedAt: null,
          leaseExpiresAt: null,
          status: "pending",
          attemptNumber: 0,
          scheduledFor: null,
          replayOf: null,
        };
        inTx(opts, () => {
          messages.set(row.id, row);
          idempotencyIndex.set(key, row.id);
          recordRollback(opts, () => {
            messages.delete(row.id);
            idempotencyIndex.delete(key);
          });
        });
        recordPostCommit(opts, () => {
          notifyChannel("postel_messages_new", `${row.tenantId ?? ""}|${row.id}`);
        });
        return { id: row.id, reused: false };
      });
    },

    async reserveBatch(opts: ReserveBatchOpts): Promise<ReadonlyArray<ReservedMessage>> {
      return writeLock.run(async () => {
        const candidates: MessageRow[] = [];
        for (const row of messages.values()) {
          if (row.status !== "pending") continue;
          if (row.reservedBy !== null) continue;
          if (opts.tenantId !== undefined && row.tenantId !== opts.tenantId) continue;
          if (row.scheduledFor !== null && row.scheduledFor > opts.now) continue;
          candidates.push(row);
        }
        const sorted = sortPendingForReservation(candidates).slice(0, opts.batchSize);
        const leaseExpiresAt = new Date(opts.now.getTime() + opts.leaseMs);
        const reserved: ReservedMessage[] = [];
        for (const row of sorted) {
          row.reservedBy = opts.workerId;
          row.reservedAt = opts.now;
          row.leaseExpiresAt = leaseExpiresAt;
          row.attemptNumber += 1;
          reserved.push(asReserved(row, leaseExpiresAt));
        }
        return reserved;
      });
    },

    async recordAttempt(attempt: NewAttempt, opts) {
      return writeLock.run(async () => {
        inTx(opts, () => {
          attempts.set(attempt.id, attempt);
          recordRollback(opts, () => attempts.delete(attempt.id));
        });
      });
    },

    async renewLease(messageId, workerId, leaseMs, now) {
      return writeLock.run(async () => {
        const row = messages.get(messageId);
        if (!row) return false;
        if (row.reservedBy !== workerId) return false;
        row.leaseExpiresAt = new Date(now.getTime() + leaseMs);
        return true;
      });
    },

    async releaseLease(messageId, workerId) {
      return writeLock.run(async () => {
        const row = messages.get(messageId);
        if (!row) return;
        if (row.reservedBy !== workerId) return;
        row.reservedBy = null;
        row.reservedAt = null;
        row.leaseExpiresAt = null;
      });
    },

    async expireStaleLeases(now) {
      return writeLock.run(async () => {
        let cleared = 0;
        for (const row of messages.values()) {
          if (row.reservedBy === null) continue;
          if (row.leaseExpiresAt !== null && row.leaseExpiresAt > now) continue;
          row.reservedBy = null;
          row.reservedAt = null;
          row.leaseExpiresAt = null;
          cleared += 1;
        }
        return cleared;
      });
    },

    async markMessageFinal(messageId, status) {
      return writeLock.run(async () => {
        const row = messages.get(messageId);
        if (!row) return;
        row.status = status;
        row.reservedBy = null;
        row.reservedAt = null;
        row.leaseExpiresAt = null;
      });
    },

    async rescheduleMessage(messageId, opts: RescheduleOpts) {
      return writeLock.run(async () => {
        const row = messages.get(messageId);
        if (!row) return;
        const prev = {
          scheduledFor: row.scheduledFor,
          reservedBy: row.reservedBy,
          reservedAt: row.reservedAt,
          leaseExpiresAt: row.leaseExpiresAt,
          status: row.status,
          replayOf: row.replayOf,
        };
        inTx(opts, () => {
          row.scheduledFor = opts.scheduledFor;
          row.reservedBy = null;
          row.reservedAt = null;
          row.leaseExpiresAt = null;
          row.status = "pending";
          if (opts.replayOf !== undefined) row.replayOf = opts.replayOf;
          recordRollback(opts, () => {
            row.scheduledFor = prev.scheduledFor;
            row.reservedBy = prev.reservedBy;
            row.reservedAt = prev.reservedAt;
            row.leaseExpiresAt = prev.leaseExpiresAt;
            row.status = prev.status;
            row.replayOf = prev.replayOf;
          });
        });
      });
    },

    async loadEndpointsForMessage(messageId) {
      const msg = messages.get(messageId);
      if (!msg) return [];
      const out: EndpointWithSecrets[] = [];
      for (const endpoint of endpoints.values()) {
        if (endpoint.tenantId !== msg.tenantId) continue;
        const eps: EndpointSecretRecord[] = [];
        for (const s of secrets.values()) {
          if (s.endpointId === endpoint.id) eps.push(s);
        }
        eps.sort((a, b) => a.priority - b.priority);
        out.push({ endpoint, secrets: eps });
      }
      return out;
    },

    async *rangeQuery(filter: RangeQueryFilter) {
      const out: ReservedMessage[] = [];
      for (const row of messages.values()) {
        if (filter.tenantId !== undefined && row.tenantId !== filter.tenantId) continue;
        if (filter.since !== undefined && row.createdAt < filter.since) continue;
        if (filter.until !== undefined && row.createdAt > filter.until) continue;
        if (filter.types !== undefined && !filter.types.includes(row.type)) continue;
        const reserved = asReserved(row, row.leaseExpiresAt ?? row.createdAt);
        if (filter.predicate !== undefined && !filter.predicate(reserved)) continue;
        out.push(reserved);
      }
      out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (const m of out) yield m;
    },

    async *reconcile(filter: ReconcileFilter) {
      const candidates: Array<{ messageId: MessageId; createdAt: Date }> = [];
      for (const row of messages.values()) {
        if (row.createdAt < filter.since) continue;
        if (filter.tenantId !== undefined && row.tenantId !== filter.tenantId) continue;
        const endpointAttempts: NewAttempt[] = [];
        for (const a of attempts.values()) {
          if (a.messageId === row.id && a.endpointId === filter.endpointId) {
            endpointAttempts.push(a);
          }
        }
        if (endpointAttempts.length === 0) {
          candidates.push({ messageId: row.id, createdAt: row.createdAt });
          continue;
        }
        endpointAttempts.sort((a, b) => a.attemptNumber - b.attemptNumber);
        const last = endpointAttempts[endpointAttempts.length - 1];
        if (last && last.status !== "success") {
          candidates.push({ messageId: row.id, createdAt: row.createdAt });
        }
      }
      candidates.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (const c of candidates) yield c.messageId;
    },

    async countPendingByTenant() {
      const out = new Map<TenantId | "_null", number>();
      for (const row of messages.values()) {
        if (row.status !== "pending") continue;
        const key: TenantId | "_null" = row.tenantId ?? "_null";
        out.set(key, (out.get(key) ?? 0) + 1);
      }
      return out;
    },

    async outboxDepth(opts) {
      let depth = 0;
      let oldest: Date | undefined;
      for (const row of messages.values()) {
        if (row.status !== "pending") continue;
        if (opts?.tenantId !== undefined && row.tenantId !== opts.tenantId) continue;
        depth += 1;
        if (oldest === undefined || row.createdAt < oldest) oldest = row.createdAt;
      }
      const now = clock.now();
      return {
        depth,
        oldestPendingAge: oldest ? now.getTime() - oldest.getTime() : undefined,
      };
    },

    attempts: {
      async countSince(endpointId, since): Promise<AttemptStatsResult> {
        let count = 0;
        let failureCount = 0;
        for (const a of attempts.values()) {
          if (a.endpointId !== endpointId) continue;
          if ((a.completedAt ?? a.startedAt ?? a.scheduledFor ?? since) < since) continue;
          count += 1;
          if (
            a.status === "failed" ||
            a.status === "failed-permanent" ||
            a.status === "dead-letter" ||
            a.status === "ssrf-blocked" ||
            a.status === "expired"
          ) {
            failureCount += 1;
          }
        }
        return { count, failureCount };
      },
      async latestForMessage(messageId) {
        const out: NewAttempt[] = [];
        for (const a of attempts.values()) {
          if (a.messageId === messageId) out.push(a);
        }
        out.sort((a, b) => a.attemptNumber - b.attemptNumber);
        return out;
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
        await writeLock.run(async () => {
          inTx(opts, () => {
            endpoints.set(full.id, full);
            recordRollback(opts, () => endpoints.delete(full.id));
          });
        });
        return full;
      },
      async update(id, patch, opts) {
        return writeLock.run(async () => {
          const prev = endpoints.get(id);
          if (!prev) throw new Error(`endpoint not found: ${id}`);
          const next: EndpointRecord = { ...prev, ...patch, id: prev.id, updatedAt: clock.now() };
          inTx(opts, () => {
            endpoints.set(id, next);
            recordRollback(opts, () => endpoints.set(id, prev));
          });
          return next;
        });
      },
      async delete(id, opts) {
        await writeLock.run(async () => {
          const prev = endpoints.get(id);
          if (!prev) return;
          const removedSecrets: EndpointSecretRecord[] = [];
          for (const [sid, s] of secrets) {
            if (s.endpointId === id) {
              removedSecrets.push(s);
              secrets.delete(sid);
            }
          }
          const purge = opts?.purgeAttempts === true;
          const removedAttempts: NewAttempt[] = [];
          const removedTransitions: EndpointStateTransition[] = [];
          if (purge) {
            for (const [aid, a] of attempts) {
              if (a.endpointId === id) {
                removedAttempts.push(a);
                attempts.delete(aid);
              }
            }
            for (const [tid, t] of stateTransitions) {
              if (t.endpointId === id) {
                removedTransitions.push(t);
                stateTransitions.delete(tid);
              }
            }
          } else {
            const transitionId = newId("trans");
            stateTransitions.set(transitionId, {
              id: transitionId,
              endpointId: id,
              fromState: prev.state,
              toState: null,
              reason: "deleted",
              actor: "system",
              metadata: null,
              occurredAt: clock.now(),
            });
          }
          endpoints.delete(id);
          recordRollback(opts, () => {
            endpoints.set(id, prev);
            for (const s of removedSecrets) secrets.set(s.id, s);
            for (const a of removedAttempts) attempts.set(a.id, a);
            for (const t of removedTransitions) stateTransitions.set(t.id, t);
          });
        });
      },
      async list(opts) {
        const out: EndpointRecord[] = [];
        for (const e of endpoints.values()) {
          if (opts?.tenantId !== undefined && e.tenantId !== opts.tenantId) continue;
          out.push(e);
        }
        out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return out;
      },
      async get(id) {
        return endpoints.get(id);
      },
      async transitionState(id, to, reason, actor, metadata, opts) {
        return writeLock.run(async () => {
          const prev = endpoints.get(id);
          if (!prev) throw new Error(`endpoint not found: ${id}`);
          const fromState = prev.state;
          const transitionId = newId("trans");
          const transition: EndpointStateTransition = {
            id: transitionId,
            endpointId: id,
            fromState,
            toState: to,
            reason,
            actor,
            metadata: metadata ?? null,
            occurredAt: clock.now(),
          };
          inTx(opts, () => {
            stateTransitions.set(transitionId, transition);
            if (to !== null) {
              const next: EndpointRecord = { ...prev, state: to, updatedAt: clock.now() };
              endpoints.set(id, next);
            }
            recordRollback(opts, () => {
              stateTransitions.delete(transitionId);
              endpoints.set(id, prev);
            });
          });
          return transition;
        });
      },
      async listStateTransitions(id) {
        const out: EndpointStateTransition[] = [];
        for (const t of stateTransitions.values()) {
          if (t.endpointId === id) out.push(t);
        }
        out.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
        return out;
      },
    },

    secrets: {
      async insert(rec, opts) {
        const full: EndpointSecretRecord = { ...rec, createdAt: clock.now() };
        await writeLock.run(async () => {
          inTx(opts, () => {
            secrets.set(full.id, full);
            recordRollback(opts, () => secrets.delete(full.id));
          });
        });
        return full;
      },
      async listForEndpoint(endpointId) {
        const out: EndpointSecretRecord[] = [];
        for (const s of secrets.values()) {
          if (s.endpointId === endpointId) out.push(s);
        }
        out.sort((a, b) => a.priority - b.priority);
        return out;
      },
      async setStatus(secretId, status, notAfter, opts) {
        await writeLock.run(async () => {
          const prev = secrets.get(secretId);
          if (!prev) throw new Error(`secret not found: ${secretId}`);
          const next: EndpointSecretRecord = { ...prev, status, notAfter };
          inTx(opts, () => {
            secrets.set(secretId, next);
            recordRollback(opts, () => secrets.set(secretId, prev));
          });
        });
      },
      async deleteExpired(now) {
        return writeLock.run(async () => {
          let removed = 0;
          for (const [sid, s] of secrets) {
            if (s.notAfter !== null && s.notAfter <= now) {
              secrets.delete(sid);
              removed += 1;
            }
          }
          return removed;
        });
      },
    },

    tenants: {
      async upsert(tenantId, metadata, opts) {
        const existing = tenants.get(tenantId);
        const rec: TenantRecord = {
          id: tenantId,
          metadata,
          createdAt: existing?.createdAt ?? clock.now(),
        };
        await writeLock.run(async () => {
          inTx(opts, () => {
            tenants.set(tenantId, rec);
            recordRollback(opts, () => {
              if (existing) tenants.set(tenantId, existing);
              else tenants.delete(tenantId);
            });
          });
        });
        return rec;
      },
      async get(tenantId) {
        return tenants.get(tenantId);
      },
      async delete(tenantId, opts) {
        await writeLock.run(async () => {
          const removedEndpoints: EndpointRecord[] = [];
          const removedSecrets: EndpointSecretRecord[] = [];
          const removedMessages: MessageRow[] = [];
          const removedAttempts: NewAttempt[] = [];
          const removedTransitions: EndpointStateTransition[] = [];
          const prevTenant = tenants.get(tenantId);
          for (const [eid, e] of endpoints) {
            if (e.tenantId !== tenantId) continue;
            removedEndpoints.push(e);
            endpoints.delete(eid);
            for (const [sid, s] of secrets) {
              if (s.endpointId === eid) {
                removedSecrets.push(s);
                secrets.delete(sid);
              }
            }
            for (const [tid, t] of stateTransitions) {
              if (t.endpointId === eid) {
                removedTransitions.push(t);
                stateTransitions.delete(tid);
              }
            }
          }
          for (const [mid, m] of messages) {
            if (m.tenantId === tenantId) {
              removedMessages.push(m);
              messages.delete(mid);
            }
          }
          for (const [aid, a] of attempts) {
            if (a.tenantId === tenantId) {
              removedAttempts.push(a);
              attempts.delete(aid);
            }
          }
          tenants.delete(tenantId);
          recordRollback(opts, () => {
            if (prevTenant) tenants.set(tenantId, prevTenant);
            for (const e of removedEndpoints) endpoints.set(e.id, e);
            for (const s of removedSecrets) secrets.set(s.id, s);
            for (const m of removedMessages) messages.set(m.id, m);
            for (const a of removedAttempts) attempts.set(a.id, a);
            for (const t of removedTransitions) stateTransitions.set(t.id, t);
          });
        });
      },
    },

    async dedup(messageId, opts) {
      const now = clock.now();
      const expiresAt = new Date(now.getTime() + opts.ttlSeconds * 1000);
      return writeLock.run(async () => {
        const existing = dedupRows.get(messageId);
        if (existing && existing.expiresAt > now) {
          return { duplicate: true };
        }
        const row: DedupRow = { messageId, expiresAt };
        if (opts.tx !== undefined && isInMemoryTx(opts.tx) && opts.tx.active) {
          const prev = existing;
          opts.tx.rollbacks.push(() => {
            if (prev) dedupRows.set(messageId, prev);
            else dedupRows.delete(messageId);
          });
        }
        dedupRows.set(messageId, row);
        return { duplicate: false };
      });
    },

    async transaction<R>(cb: (tx: InMemoryTx) => Promise<R>): Promise<R> {
      const tx: InMemoryTx = createTx();
      try {
        const result = await cb(tx);
        tx.active = false;
        for (const hook of tx.postCommit) hook();
        return result;
      } catch (e) {
        tx.active = false;
        for (let i = tx.rollbacks.length - 1; i >= 0; i--) {
          const undo = tx.rollbacks[i];
          if (undo) undo();
        }
        throw e;
      }
    },

    async notify(channel, payload) {
      notifyChannel(channel, payload ?? "");
    },

    subscribe(channel, handler): Unsubscribe {
      const set = listeners.get(channel) ?? new Set<(payload: string) => void>();
      set.add(handler);
      listeners.set(channel, set);
      return () => {
        set.delete(handler);
      };
    },
  };
}
