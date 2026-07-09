import type { EndpointRecord, NewAttempt, NewMessage } from "@postel/core";
import { describe, expect, it } from "vitest";

import {
  MYSQL_CAPABILITIES,
  MYSQL_CODEC,
  PG_CAPABILITIES,
  PG_CODEC,
  POSTEL_SCHEMA_VERSION,
  SQLITE_CAPABILITIES,
  SQLITE_CODEC,
  attachCallbacks,
  createCallbackRegistry,
  decodeAttempt,
  decodeEndpoint,
  decodeReservedMessage,
  decodeSecret,
  decodeTimestamp,
  encodeAttemptInsert,
  encodeEndpointInsert,
  encodeJson,
  encodeMessageInsert,
  encodeSecretInsert,
  encodeTimestamp,
  formatIdempotencyKey,
} from "../src/index.js";
import { MYSQL_MIGRATIONS } from "../src/migrations.js";

// Requirement: Helpers package for adapter authors
describe("Helpers package for adapter authors", () => {
  it("Adapter author imports helpers: capability flag sets are canonical", () => {
    expect(PG_CAPABILITIES).toEqual({
      notify: true,
      subscribe: true,
      transactional: true,
      streaming: true,
    });
    expect(SQLITE_CAPABILITIES.notify).toBe(false);
    expect(SQLITE_CAPABILITIES.subscribe).toBe(false);
    expect(SQLITE_CAPABILITIES.transactional).toBe(true);
    // MySQL falls back to polling like SQLite but stays a real transactional server.
    expect(MYSQL_CAPABILITIES.notify).toBe(false);
    expect(MYSQL_CAPABILITIES.subscribe).toBe(false);
    expect(MYSQL_CAPABILITIES.transactional).toBe(true);
    expect(MYSQL_CAPABILITIES.streaming).toBe(true);
  });

  it("exposes the schema version the library targets", () => {
    expect(POSTEL_SCHEMA_VERSION).toBe(5);
  });

  it("formats the tenant-scoped idempotency key like the in-memory reference", () => {
    expect(formatIdempotencyKey(null, "abc")).toBe("|abc");
    expect(formatIdempotencyKey("t_42", "abc")).toBe("t_42|abc");
    expect(formatIdempotencyKey("t_42", null)).toBeUndefined();
  });
});

describe("timestamp codec", () => {
  const d = new Date("2026-05-26T10:00:00.000Z");

  it("Postgres keeps native Date; SQLite serializes to ISO-8601; MySQL to epoch-ms", () => {
    expect(encodeTimestamp(d, PG_CODEC)).toBe(d);
    expect(encodeTimestamp(d, SQLITE_CODEC)).toBe("2026-05-26T10:00:00.000Z");
    expect(encodeTimestamp(d, MYSQL_CODEC)).toBe(d.getTime());
    expect(encodeTimestamp(null, SQLITE_CODEC)).toBeNull();
    expect(encodeTimestamp(null, MYSQL_CODEC)).toBeNull();
  });

  it("decodes Date, ISO string, and epoch-ms back to a Date", () => {
    expect(decodeTimestamp(d, PG_CODEC)?.getTime()).toBe(d.getTime());
    expect(decodeTimestamp("2026-05-26T10:00:00.000Z", SQLITE_CODEC)?.getTime()).toBe(d.getTime());
    expect(decodeTimestamp(d.getTime(), SQLITE_CODEC)?.getTime()).toBe(d.getTime());
    expect(decodeTimestamp(null, PG_CODEC)).toBeNull();
  });

  it("decodes MySQL epoch-ms from number, numeric string, and bigint", () => {
    // mysql2 may surface a BIGINT as any of these depending on its bigint config.
    expect(decodeTimestamp(d.getTime(), MYSQL_CODEC)?.getTime()).toBe(d.getTime());
    expect(decodeTimestamp(String(d.getTime()), MYSQL_CODEC)?.getTime()).toBe(d.getTime());
    expect(decodeTimestamp(BigInt(d.getTime()), MYSQL_CODEC)?.getTime()).toBe(d.getTime());
    expect(decodeTimestamp(null, MYSQL_CODEC)).toBeNull();
  });
});

describe("json codec", () => {
  it("Postgres passes objects through; SQLite stringifies", () => {
    const obj = { a: 1, b: ["x"] };
    expect(encodeJson(obj, PG_CODEC)).toBe(obj);
    expect(encodeJson(obj, SQLITE_CODEC)).toBe('{"a":1,"b":["x"]}');
    expect(encodeJson(null, SQLITE_CODEC)).toBeNull();
  });
});

function buildMessage(): NewMessage {
  return {
    id: "msg_1",
    tenantId: "t_1",
    type: "order.created",
    data: { id: "ord_1" },
    channels: ["billing"],
    idempotencyKey: "idem_1",
    version: "1",
    ttlSeconds: 3600,
    createdAt: new Date("2026-05-26T10:00:00.000Z"),
    expiresAt: new Date("2026-05-26T11:00:00.000Z"),
    replayOf: null,
  };
}

describe("message row codec", () => {
  for (const [name, codec] of [
    ["postgres", PG_CODEC],
    ["sqlite", SQLITE_CODEC],
    ["mysql", MYSQL_CODEC],
  ] as const) {
    it(`round-trips a message through ${name} columns`, () => {
      const row = encodeMessageInsert(buildMessage(), codec);
      expect(row.status).toBe("pending");
      expect(row.attempt_number).toBe(0);
      // Simulate a reserved row read-back (lease + attempt stamped by reserveBatch).
      const reservedRow = {
        ...row,
        attempt_number: 1,
        lease_expires_at: encodeTimestamp(new Date("2026-05-26T10:01:00.000Z"), codec),
      };
      const reserved = decodeReservedMessage(reservedRow, codec);
      expect(reserved.id).toBe("msg_1");
      expect(reserved.tenantId).toBe("t_1");
      expect(reserved.data).toEqual({ id: "ord_1" });
      expect(reserved.channels).toEqual(["billing"]);
      expect(reserved.createdAt.toISOString()).toBe("2026-05-26T10:00:00.000Z");
      expect(reserved.attemptNumber).toBe(1);
      expect(reserved.leaseExpiresAt.toISOString()).toBe("2026-05-26T10:01:00.000Z");
    });
  }
});

describe("attempt row codec", () => {
  const attempt: NewAttempt = {
    id: "att_1",
    messageId: "msg_1",
    endpointId: "ep_1",
    tenantId: "t_1",
    attemptNumber: 2,
    status: "ssrf-blocked",
    scheduledFor: null,
    startedAt: new Date("2026-05-26T10:00:00.000Z"),
    completedAt: new Date("2026-05-26T10:00:01.000Z"),
    responseCode: null,
    responseHeaders: { "x-test": "1" },
    responseBody: null,
    latencyMs: 12,
    error: "SSRF_BLOCKED",
    replayOf: null,
  };

  it("round-trips an attempt (kebab-case status preserved) through sqlite columns", () => {
    const row = encodeAttemptInsert(attempt, SQLITE_CODEC);
    const back = decodeAttempt({ ...row }, SQLITE_CODEC);
    expect(back.status).toBe("ssrf-blocked");
    expect(back.attemptNumber).toBe(2);
    expect(back.responseHeaders).toEqual({ "x-test": "1" });
    expect(back.latencyMs).toBe(12);
  });
});

function buildEndpoint(): EndpointRecord {
  return {
    id: "ep_1",
    tenantId: "t_1",
    url: "https://example.com/hook",
    state: "active",
    types: ["order.*"],
    channels: null,
    retryPolicy: { maxAttempts: 5 },
    headers: { "x-custom": "v" },
    signing: { algorithm: "v1" },
    metadata: { team: "billing" },
    allowHttp: false,
    maxInflight: 10,
    http: null,
    circuitBreaker: null,
    autoDisable: null,
    filter: { dataPath: "region", equals: "eu" },
    filterFn: null,
    transform: null,
    createdAt: new Date("2026-05-26T10:00:00.000Z"),
    updatedAt: new Date("2026-05-26T10:00:00.000Z"),
  };
}

describe("endpoint row codec", () => {
  it("round-trips an endpoint and decodes sqlite 0/1 allow_http to boolean", () => {
    const row = encodeEndpointInsert(buildEndpoint(), SQLITE_CODEC);
    // SQLite would persist the boolean as 0/1; simulate that on read-back.
    const back = decodeEndpoint({ ...row, allow_http: 0 }, SQLITE_CODEC);
    expect(back.allowHttp).toBe(false);
    expect(back.maxInflight).toBe(10);
    expect(back.retryPolicy).toEqual({ maxAttempts: 5 });
    expect(back.types).toEqual(["order.*"]);
    expect(back.filter).toEqual({ dataPath: "region", equals: "eu" });
    expect(back.filterFn).toBeNull();
    expect(back.transform).toBeNull();
  });
});

describe("secret row codec", () => {
  it("round-trips encrypted bytes and an optional public key", () => {
    const enc = new Uint8Array([1, 2, 3]);
    const pub = new Uint8Array([9, 8, 7]);
    const row = encodeSecretInsert(
      {
        id: "sec_1",
        endpointId: "ep_1",
        algorithm: "v1a",
        status: "primary",
        priority: 0,
        encryptedValue: enc,
        publicKey: pub,
        notAfter: null,
      },
      PG_CODEC,
    );
    const back = decodeSecret({ ...row, created_at: new Date() }, PG_CODEC);
    expect(Array.from(back.encryptedValue)).toEqual([1, 2, 3]);
    expect(back.publicKey && Array.from(back.publicKey)).toEqual([9, 8, 7]);
    expect(back.algorithm).toBe("v1a");
  });
});

describe("callback registry", () => {
  it("stores, patches, attaches, and deletes code-side callbacks by endpoint id", () => {
    const registry = createCallbackRegistry();
    const filterFn = (): boolean => true;
    registry.set("ep_1", { filterFn });
    expect(registry.get("ep_1").filterFn).toBe(filterFn);
    expect(registry.get("ep_1").transform).toBeNull();

    const transform = (e: unknown): unknown => e;
    registry.applyPatch("ep_1", { transform });
    expect(registry.get("ep_1").filterFn).toBe(filterFn); // patch preserves untouched key
    expect(registry.get("ep_1").transform).toBe(transform);

    const attached = attachCallbacks(buildEndpoint(), registry);
    expect(attached.filterFn).toBe(filterFn);
    expect(attached.transform).toBe(transform);

    registry.delete("ep_1");
    expect(registry.get("ep_1").filterFn).toBeNull();
  });
});

describe("MySQL migrations dialect", () => {
  it("forward-only versions 1..5 ending at the target schema version", () => {
    expect(MYSQL_MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5]);
    expect(MYSQL_MIGRATIONS.at(-1)?.version).toBe(POSTEL_SCHEMA_VERSION);
  });

  it("translates the canonical DDL to MySQL dialect (no pg/sqlite types)", () => {
    const init = MYSQL_MIGRATIONS[0]?.sql ?? "";
    // Epoch-ms BIGINT timestamps, JSON columns, VARCHAR keys, backtick-quoted `key`.
    expect(init).toContain("created_at BIGINT NOT NULL");
    expect(init).toContain("data             JSON NOT NULL");
    expect(init).toContain("VARCHAR(191) PRIMARY KEY");
    expect(init).toContain("`key`");
    expect(init).toContain("ON DUPLICATE KEY UPDATE");
    // No Postgres / SQLite dialect leaking in.
    expect(init).not.toContain("timestamptz");
    expect(init).not.toContain("jsonb");
    expect(init).not.toContain("ON CONFLICT");
    // No partial indexes (MySQL has none).
    expect(init).not.toContain("WHERE idempotency_key");
  });
});
