// Drizzle table definitions for the canonical schema (specs/db-schema/), one
// namespace per dialect. A host merges the relevant namespace into their own
// Drizzle schema file and migrates it with their ORM's native tooling
// (drizzle-kit) instead of relying on DrizzleStorage's `autoMigrate`.
//
// ponytail: the `dead_letter` view (a read-only SELECT over `attempts`) is not
// included — autoMigrate / the standalone adapters still create it, and it
// carries no columns a host would insert through. Add it if a host asks to
// browse it via drizzle-kit studio.
//
// ponytail: the MySQL table set doesn't pin utf8mb4_bin collation (ADR 0015)
// the way the raw migration SQL does — drizzle-orm 0.36's mysql-core column
// builders have no per-column collation option. A host generating DDL from
// this fragment should set the table/database default collation to
// utf8mb4_bin to preserve the byte-order pagination tie-break.

import * as mysql from "drizzle-orm/mysql-core";
import * as pg from "drizzle-orm/pg-core";
import * as sqlite from "drizzle-orm/sqlite-core";

export const pgTenants = pg.pgTable("tenants", {
  id: pg.text("id").primaryKey(),
  metadata: pg.jsonb("metadata"),
  createdAt: pg
    .timestamp("created_at", { withTimezone: true, precision: 3 })
    .defaultNow()
    .notNull(),
});

export const pgEndpoints = pg.pgTable("endpoints", {
  id: pg.text("id").primaryKey(),
  tenantId: pg.text("tenant_id"),
  url: pg.text("url").notNull(),
  state: pg.text("state").notNull().default("active"),
  types: pg.jsonb("types"),
  channels: pg.jsonb("channels"),
  retryPolicy: pg.jsonb("retry_policy"),
  headers: pg.jsonb("headers"),
  signing: pg.jsonb("signing"),
  metadata: pg.jsonb("metadata"),
  createdAt: pg
    .timestamp("created_at", { withTimezone: true, precision: 3 })
    .defaultNow()
    .notNull(),
  updatedAt: pg.timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  allowHttp: pg.boolean("allow_http").notNull().default(false),
  maxInflight: pg.integer("max_inflight"),
  http: pg.jsonb("http"),
  circuitBreaker: pg.jsonb("circuit_breaker"),
  autoDisable: pg.jsonb("auto_disable"),
  filter: pg.jsonb("filter"),
});

export const pgEndpointSecrets = pg.pgTable("endpoint_secrets", {
  id: pg.text("id").primaryKey(),
  endpointId: pg.text("endpoint_id").notNull(),
  algorithm: pg.text("algorithm").notNull(),
  status: pg.text("status").notNull(),
  priority: pg.integer("priority").notNull(),
  material: pg
    .customType<{ data: Buffer }>({ dataType: () => "bytea" })("material")
    .notNull(),
  notAfter: pg.timestamp("not_after", { withTimezone: true }),
  createdAt: pg.timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  publicKey: pg.customType<{ data: Buffer }>({ dataType: () => "bytea" })("public_key"),
  encryption: pg.text("encryption").notNull().default("plaintext"),
});

export const pgMessages = pg.pgTable("messages", {
  id: pg.text("id").primaryKey(),
  tenantId: pg.text("tenant_id"),
  type: pg.text("type").notNull(),
  data: pg.jsonb("data").notNull(),
  channels: pg.jsonb("channels"),
  idempotencyKey: pg.text("idempotency_key"),
  version: pg.text("version"),
  ttlSeconds: pg.integer("ttl_seconds"),
  createdAt: pg
    .timestamp("created_at", { withTimezone: true, precision: 3 })
    .defaultNow()
    .notNull(),
  expiresAt: pg.timestamp("expires_at", { withTimezone: true }),
  reservedBy: pg.text("reserved_by"),
  reservedAt: pg.timestamp("reserved_at", { withTimezone: true }),
  leaseExpiresAt: pg.timestamp("lease_expires_at", { withTimezone: true }),
  status: pg.text("status").notNull().default("pending"),
  attemptNumber: pg.integer("attempt_number").notNull().default(0),
  scheduledFor: pg.timestamp("scheduled_for", { withTimezone: true }),
  replayOf: pg.text("replay_of"),
});

export const pgAttempts = pg.pgTable("attempts", {
  id: pg.text("id").primaryKey(),
  messageId: pg.text("message_id").notNull(),
  endpointId: pg.text("endpoint_id").notNull(),
  tenantId: pg.text("tenant_id"),
  attemptNumber: pg.integer("attempt_number").notNull(),
  status: pg.text("status").notNull(),
  scheduledFor: pg.timestamp("scheduled_for", { withTimezone: true }),
  startedAt: pg.timestamp("started_at", { withTimezone: true }),
  completedAt: pg.timestamp("completed_at", { withTimezone: true }),
  responseCode: pg.integer("response_code"),
  responseHeaders: pg.jsonb("response_headers"),
  responseBody: pg.text("response_body"),
  latencyMs: pg.integer("latency_ms"),
  error: pg.text("error"),
  replayOf: pg.text("replay_of"),
});

export const pgEndpointStateTransitions = pg.pgTable("endpoint_state_transitions", {
  id: pg.text("id").primaryKey(),
  endpointId: pg.text("endpoint_id").notNull(),
  fromState: pg.text("from_state"),
  toState: pg.text("to_state").notNull(),
  reason: pg.text("reason").notNull(),
  actor: pg.text("actor"),
  metadata: pg.jsonb("metadata"),
  occurredAt: pg.timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
});

export const pgReceivedMessages = pg.pgTable("postel_received_messages", {
  messageId: pg.text("message_id").primaryKey(),
  expiresAt: pg.timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const mysqlTenants = mysql.mysqlTable("tenants", {
  id: mysql.varchar("id", { length: 191 }).primaryKey(),
  metadata: mysql.json("metadata"),
  createdAt: mysql.bigint("created_at", { mode: "number" }).notNull(),
});

export const mysqlEndpoints = mysql.mysqlTable("endpoints", {
  id: mysql.varchar("id", { length: 191 }).primaryKey(),
  tenantId: mysql.varchar("tenant_id", { length: 191 }),
  url: mysql.text("url").notNull(),
  state: mysql.varchar("state", { length: 191 }).notNull().default("active"),
  types: mysql.json("types"),
  channels: mysql.json("channels"),
  retryPolicy: mysql.json("retry_policy"),
  headers: mysql.json("headers"),
  signing: mysql.json("signing"),
  metadata: mysql.json("metadata"),
  createdAt: mysql.bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: mysql.bigint("updated_at", { mode: "number" }).notNull(),
  allowHttp: mysql.boolean("allow_http").notNull().default(false),
  maxInflight: mysql.int("max_inflight"),
  http: mysql.json("http"),
  circuitBreaker: mysql.json("circuit_breaker"),
  autoDisable: mysql.json("auto_disable"),
  filter: mysql.json("filter"),
});

export const mysqlEndpointSecrets = mysql.mysqlTable("endpoint_secrets", {
  id: mysql.varchar("id", { length: 191 }).primaryKey(),
  endpointId: mysql.varchar("endpoint_id", { length: 191 }).notNull(),
  algorithm: mysql.varchar("algorithm", { length: 191 }).notNull(),
  status: mysql.varchar("status", { length: 191 }).notNull(),
  priority: mysql.int("priority").notNull(),
  material: mysql
    .customType<{ data: Buffer }>({ dataType: () => "blob" })("material")
    .notNull(),
  notAfter: mysql.bigint("not_after", { mode: "number" }),
  createdAt: mysql.bigint("created_at", { mode: "number" }).notNull(),
  publicKey: mysql.customType<{ data: Buffer }>({ dataType: () => "blob" })("public_key"),
  encryption: mysql.varchar("encryption", { length: 191 }).notNull().default("plaintext"),
});

export const mysqlMessages = mysql.mysqlTable("messages", {
  id: mysql.varchar("id", { length: 191 }).primaryKey(),
  tenantId: mysql.varchar("tenant_id", { length: 191 }),
  type: mysql.varchar("type", { length: 191 }).notNull(),
  data: mysql.json("data").notNull(),
  channels: mysql.json("channels"),
  idempotencyKey: mysql.varchar("idempotency_key", { length: 191 }),
  version: mysql.varchar("version", { length: 191 }),
  ttlSeconds: mysql.int("ttl_seconds"),
  createdAt: mysql.bigint("created_at", { mode: "number" }).notNull(),
  expiresAt: mysql.bigint("expires_at", { mode: "number" }),
  reservedBy: mysql.varchar("reserved_by", { length: 191 }),
  reservedAt: mysql.bigint("reserved_at", { mode: "number" }),
  leaseExpiresAt: mysql.bigint("lease_expires_at", { mode: "number" }),
  status: mysql.varchar("status", { length: 191 }).notNull().default("pending"),
  attemptNumber: mysql.int("attempt_number").notNull().default(0),
  scheduledFor: mysql.bigint("scheduled_for", { mode: "number" }),
  replayOf: mysql.varchar("replay_of", { length: 191 }),
});

export const mysqlAttempts = mysql.mysqlTable("attempts", {
  id: mysql.varchar("id", { length: 191 }).primaryKey(),
  messageId: mysql.varchar("message_id", { length: 191 }).notNull(),
  endpointId: mysql.varchar("endpoint_id", { length: 191 }).notNull(),
  tenantId: mysql.varchar("tenant_id", { length: 191 }),
  attemptNumber: mysql.int("attempt_number").notNull(),
  status: mysql.varchar("status", { length: 191 }).notNull(),
  scheduledFor: mysql.bigint("scheduled_for", { mode: "number" }),
  startedAt: mysql.bigint("started_at", { mode: "number" }),
  completedAt: mysql.bigint("completed_at", { mode: "number" }),
  responseCode: mysql.int("response_code"),
  responseHeaders: mysql.json("response_headers"),
  responseBody: mysql.longtext("response_body"),
  latencyMs: mysql.int("latency_ms"),
  error: mysql.text("error"),
  replayOf: mysql.varchar("replay_of", { length: 191 }),
});

export const mysqlEndpointStateTransitions = mysql.mysqlTable("endpoint_state_transitions", {
  id: mysql.varchar("id", { length: 191 }).primaryKey(),
  endpointId: mysql.varchar("endpoint_id", { length: 191 }).notNull(),
  fromState: mysql.varchar("from_state", { length: 191 }),
  toState: mysql.varchar("to_state", { length: 191 }).notNull(),
  reason: mysql.text("reason").notNull(),
  actor: mysql.varchar("actor", { length: 191 }),
  metadata: mysql.json("metadata"),
  occurredAt: mysql.bigint("occurred_at", { mode: "number" }).notNull(),
});

export const mysqlReceivedMessages = mysql.mysqlTable("postel_received_messages", {
  messageId: mysql.varchar("message_id", { length: 191 }).primaryKey(),
  expiresAt: mysql.bigint("expires_at", { mode: "number" }).notNull(),
});

export const sqliteTenants = sqlite.sqliteTable("tenants", {
  id: sqlite.text("id").primaryKey(),
  metadata: sqlite.text("metadata"),
  createdAt: sqlite.text("created_at").notNull(),
});

export const sqliteEndpoints = sqlite.sqliteTable("endpoints", {
  id: sqlite.text("id").primaryKey(),
  tenantId: sqlite.text("tenant_id"),
  url: sqlite.text("url").notNull(),
  state: sqlite.text("state").notNull().default("active"),
  types: sqlite.text("types"),
  channels: sqlite.text("channels"),
  retryPolicy: sqlite.text("retry_policy"),
  headers: sqlite.text("headers"),
  signing: sqlite.text("signing"),
  metadata: sqlite.text("metadata"),
  createdAt: sqlite.text("created_at").notNull(),
  updatedAt: sqlite.text("updated_at").notNull(),
  allowHttp: sqlite.integer("allow_http", { mode: "boolean" }).notNull().default(false),
  maxInflight: sqlite.integer("max_inflight"),
  http: sqlite.text("http"),
  circuitBreaker: sqlite.text("circuit_breaker"),
  autoDisable: sqlite.text("auto_disable"),
  filter: sqlite.text("filter"),
});

export const sqliteEndpointSecrets = sqlite.sqliteTable("endpoint_secrets", {
  id: sqlite.text("id").primaryKey(),
  endpointId: sqlite.text("endpoint_id").notNull(),
  algorithm: sqlite.text("algorithm").notNull(),
  status: sqlite.text("status").notNull(),
  priority: sqlite.integer("priority").notNull(),
  material: sqlite.blob("material").notNull(),
  notAfter: sqlite.text("not_after"),
  createdAt: sqlite.text("created_at").notNull(),
  publicKey: sqlite.blob("public_key"),
  encryption: sqlite.text("encryption").notNull().default("plaintext"),
});

export const sqliteMessages = sqlite.sqliteTable("messages", {
  id: sqlite.text("id").primaryKey(),
  tenantId: sqlite.text("tenant_id"),
  type: sqlite.text("type").notNull(),
  data: sqlite.text("data").notNull(),
  channels: sqlite.text("channels"),
  idempotencyKey: sqlite.text("idempotency_key"),
  version: sqlite.text("version"),
  ttlSeconds: sqlite.integer("ttl_seconds"),
  createdAt: sqlite.text("created_at").notNull(),
  expiresAt: sqlite.text("expires_at"),
  reservedBy: sqlite.text("reserved_by"),
  reservedAt: sqlite.text("reserved_at"),
  leaseExpiresAt: sqlite.text("lease_expires_at"),
  status: sqlite.text("status").notNull().default("pending"),
  attemptNumber: sqlite.integer("attempt_number").notNull().default(0),
  scheduledFor: sqlite.text("scheduled_for"),
  replayOf: sqlite.text("replay_of"),
});

export const sqliteAttempts = sqlite.sqliteTable("attempts", {
  id: sqlite.text("id").primaryKey(),
  messageId: sqlite.text("message_id").notNull(),
  endpointId: sqlite.text("endpoint_id").notNull(),
  tenantId: sqlite.text("tenant_id"),
  attemptNumber: sqlite.integer("attempt_number").notNull(),
  status: sqlite.text("status").notNull(),
  scheduledFor: sqlite.text("scheduled_for"),
  startedAt: sqlite.text("started_at"),
  completedAt: sqlite.text("completed_at"),
  responseCode: sqlite.integer("response_code"),
  responseHeaders: sqlite.text("response_headers"),
  responseBody: sqlite.text("response_body"),
  latencyMs: sqlite.integer("latency_ms"),
  error: sqlite.text("error"),
  replayOf: sqlite.text("replay_of"),
});

export const sqliteEndpointStateTransitions = sqlite.sqliteTable("endpoint_state_transitions", {
  id: sqlite.text("id").primaryKey(),
  endpointId: sqlite.text("endpoint_id").notNull(),
  fromState: sqlite.text("from_state"),
  toState: sqlite.text("to_state").notNull(),
  reason: sqlite.text("reason").notNull(),
  actor: sqlite.text("actor"),
  metadata: sqlite.text("metadata"),
  occurredAt: sqlite.text("occurred_at").notNull(),
});

export const sqliteReceivedMessages = sqlite.sqliteTable("postel_received_messages", {
  messageId: sqlite.text("message_id").primaryKey(),
  expiresAt: sqlite.text("expires_at").notNull(),
});
