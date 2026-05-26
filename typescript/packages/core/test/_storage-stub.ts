import type { NewMessage, ReservedMessage, Storage, StorageCapabilities } from "../src/index.js";

const CAPS: StorageCapabilities = {
  notify: false,
  subscribe: false,
  transactional: false,
  streaming: false,
};

export function StorageStub(): Storage {
  const rows = new Map<string, NewMessage>();
  const idempotency = new Map<string, string>();
  return {
    capabilities: CAPS,
    async schemaVersion() {
      return 1;
    },
    async insertMessage(msg, _opts) {
      rows.set(msg.id, msg);
      return msg.id;
    },
    async insertOrReuseByIdempotencyKey(msg, _opts) {
      const key = `${msg.tenantId ?? ""}|${msg.idempotencyKey ?? ""}`;
      const prev = msg.idempotencyKey !== null ? idempotency.get(key) : undefined;
      if (prev !== undefined) return { id: prev, reused: true };
      rows.set(msg.id, msg);
      if (msg.idempotencyKey !== null) idempotency.set(key, msg.id);
      return { id: msg.id, reused: false };
    },
    async reserveBatch() {
      return [];
    },
    async recordAttempt() {},
    async renewLease() {
      return false;
    },
    async releaseLease() {},
    async expireStaleLeases() {
      return 0;
    },
    async markMessageFinal() {},
    async rescheduleMessage() {},
    async loadEndpointsForMessage() {
      return [];
    },
    async *rangeQuery(): AsyncIterable<ReservedMessage> {},
    async *reconcile(): AsyncIterable<string> {},
    async countPendingByTenant() {
      return new Map();
    },
    async outboxDepth() {
      return { depth: rows.size, oldestPendingAge: undefined };
    },
    attempts: {
      async countSince() {
        return { count: 0, failureCount: 0 };
      },
      async latestForMessage() {
        return [];
      },
    },
    endpoints: {
      async create() {
        throw new Error("not implemented");
      },
      async update() {
        throw new Error("not implemented");
      },
      async delete() {},
      async list() {
        return [];
      },
      async get() {
        return undefined;
      },
      async transitionState() {
        throw new Error("not implemented");
      },
      async listStateTransitions() {
        return [];
      },
    },
    secrets: {
      async insert() {
        throw new Error("not implemented");
      },
      async listForEndpoint() {
        return [];
      },
      async setStatus() {},
      async deleteExpired() {
        return 0;
      },
    },
    tenants: {
      async upsert() {
        throw new Error("not implemented");
      },
      async get() {
        return undefined;
      },
      async delete() {},
    },
    async dedup() {
      return { duplicate: false };
    },
    async transaction(cb) {
      return cb({});
    },
  };
}
