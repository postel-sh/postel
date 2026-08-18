#!/usr/bin/env node
//
// typescript/packages/compliance-driver/scripts/pg-conformance.mjs
//
// Docker-gated (set POSTEL_PG_TESTCONTAINERS=1 to run — mirrors
// @postel/pg's own testcontainers.test.ts gate). Backs the AGENTS.md
// DB-schema conformance claim for the TS port (#149): starts a real
// Postgres via testcontainers, runs the compliance-driver in pg mode,
// drives the full v0.2 sender corpus against it through the built Go
// compliance runner, then asserts the resulting rows' column shape and
// enum-valued columns conform to specs/db-schema/0001_init.sql plus its
// migrations — not just InMemoryStorage.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");
const DRIVER_ENTRY = resolve(__dirname, "../dist/cli.js");
const COMPLIANCE_BIN = process.env.POSTEL_COMPLIANCE_BIN ?? resolve(REPO_ROOT, "bin/compliance");
const VECTORS_DIR = resolve(REPO_ROOT, "compliance/vectors");
const SCHEMA_DIR = resolve(REPO_ROOT, "compliance/schema");

if (!process.env.POSTEL_PG_TESTCONTAINERS) {
  console.log("pg-conformance: skipped (set POSTEL_PG_TESTCONTAINERS=1, Docker required)");
  process.exit(0);
}

const failures = [];
function check(name, condition, detail = "") {
  if (!condition) failures.push(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  else console.log(`ok: ${name}`);
}

// Column set per specs/db-schema/0001_init.sql plus the 0002-0007
// migrations — the canonical shape @postel/pg's autoMigrate brings a fresh
// database to. Drift here means the pg adapter's migrations and the
// checked-in DDL spec have diverged.
const EXPECTED_COLUMNS = {
  tenants: ["id", "metadata", "created_at"],
  endpoints: [
    "id",
    "tenant_id",
    "url",
    "state",
    "types",
    "channels",
    "retry_policy",
    "headers",
    "signing",
    "metadata",
    "created_at",
    "updated_at",
    "allow_http",
    "max_inflight",
    "http",
    "circuit_breaker",
    "auto_disable",
    "filter",
  ],
  endpoint_secrets: [
    "id",
    "endpoint_id",
    "algorithm",
    "status",
    "priority",
    "material",
    "not_after",
    "created_at",
    "public_key",
    "encryption",
  ],
  messages: [
    "id",
    "tenant_id",
    "type",
    "data",
    "channels",
    "idempotency_key",
    "version",
    "ttl_seconds",
    "created_at",
    "expires_at",
    "reserved_by",
    "reserved_at",
    "lease_expires_at",
    "status",
    "attempt_number",
    "scheduled_for",
    "replay_of",
  ],
  attempts: [
    "id",
    "message_id",
    "endpoint_id",
    "tenant_id",
    "attempt_number",
    "status",
    "scheduled_for",
    "started_at",
    "completed_at",
    "response_code",
    "response_headers",
    "response_body",
    "latency_ms",
    "error",
    "replay_of",
  ],
  endpoint_state_transitions: [
    "id",
    "endpoint_id",
    "from_state",
    "to_state",
    "reason",
    "actor",
    "metadata",
    "occurred_at",
  ],
  postel_received_messages: ["message_id", "expires_at"],
};

const ENDPOINT_STATES = ["active", "disabled", "circuit-open"];
const SECRET_ALGORITHMS = ["v1", "v1a"];
const SECRET_STATUSES = ["primary", "verifying", "expiring"];
const MESSAGE_STATUSES = ["pending", "dispatched", "dead-lettered", "expired"];
const ATTEMPT_STATUSES = [
  "pending",
  "success",
  "failed",
  "failed-permanent",
  "dead-letter",
  "expired",
  "filtered",
  "skipped",
  "ssrf-blocked",
];

// Reads the driver's one-line `{"port":...,"pid":...}` announcement off its
// stdout — the same contract mise's compliance:sender:ts task relies on.
function waitForDriverPort(child) {
  return new Promise((resolvePromise, reject) => {
    let buf = "";
    const onData = (chunk) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      child.stdout.off("data", onData);
      try {
        resolvePromise(JSON.parse(buf.slice(0, nl)).port);
      } catch (err) {
        reject(new Error(`could not parse driver startup line: ${err.message}\n${buf}`));
      }
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== null && code !== 0) {
        reject(new Error(`driver exited with code ${code} before printing its port`));
      }
    });
  });
}

async function waitForDriverReady(child, url) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${url}/control/info`);
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) {
      throw new Error(`driver exited prematurely with code ${child.exitCode}`);
    }
    await sleep(100);
  }
  throw new Error("driver did not become ready within 10s");
}

function runComplianceBinary(senderControlUrl) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      COMPLIANCE_BIN,
      ["--sender-control", senderControlUrl, "--vectors", VECTORS_DIR, "--schema-dir", SCHEMA_DIR, "--format", "json"],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.once("error", reject);
    child.once("close", () => {
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`compliance binary output was not valid JSON: ${err.message}\n${stdout}`));
      }
    });
  });
}

async function assertColumnShape(pool) {
  for (const [table, expectedCols] of Object.entries(EXPECTED_COLUMNS)) {
    const { rows } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
      [table],
    );
    const actual = new Set(rows.map((r) => r.column_name));
    const missing = expectedCols.filter((c) => !actual.has(c));
    const extra = [...actual].filter((c) => !expectedCols.includes(c));
    check(
      `${table}: column set matches specs/db-schema/`,
      missing.length === 0 && extra.length === 0,
      `missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`,
    );
  }
}

// The driver's /control/reset TRUNCATEs before every vector (matching the
// InMemoryStorage behavior the corpus already assumes for isolation), so by
// the time the corpus run finishes, only the LAST executed vector's rows
// remain — these checks validate the shape/vocabulary of whatever's left,
// not the union across the whole corpus. That's still a real, non-trivial
// check (it's live data written through the real sender path onto a real
// jsonb/timestamptz/bytea schema, not a fixture), just not an exhaustive
// enum sweep.
async function assertRowShape(pool) {
  const meta = await pool.query("SELECT value FROM _postel_meta WHERE key = 'schema_version'");
  check("_postel_meta.schema_version is 7", meta.rows[0]?.value === "7", JSON.stringify(meta.rows));

  const endpoints = await pool.query("SELECT id, state FROM endpoints");
  check("endpoints has rows after the sender corpus run", endpoints.rows.length > 0);
  for (const row of endpoints.rows) {
    check(`endpoints.state is documented (${row.id})`, ENDPOINT_STATES.includes(row.state), row.state);
  }

  const secrets = await pool.query("SELECT algorithm, status, material, encryption FROM endpoint_secrets");
  check("endpoint_secrets has rows after the sender corpus run", secrets.rows.length > 0);
  for (const row of secrets.rows) {
    check("endpoint_secrets.algorithm is documented", SECRET_ALGORITHMS.includes(row.algorithm), row.algorithm);
    check("endpoint_secrets.status is documented", SECRET_STATUSES.includes(row.status), row.status);
    check("endpoint_secrets.material is bytea", Buffer.isBuffer(row.material));
    check("endpoint_secrets.encryption is 'plaintext'", row.encryption === "plaintext", row.encryption);
  }

  const messages = await pool.query("SELECT status, data FROM messages");
  check("messages has rows after the sender corpus run", messages.rows.length > 0);
  for (const row of messages.rows) {
    check("messages.status is documented", MESSAGE_STATUSES.includes(row.status), row.status);
    check("messages.data is a JSON object", row.data !== null && typeof row.data === "object");
  }

  const attempts = await pool.query("SELECT status FROM attempts");
  check("attempts has rows after the sender corpus run", attempts.rows.length > 0);
  for (const row of attempts.rows) {
    check("attempts.status is documented", ATTEMPT_STATUSES.includes(row.status), row.status);
  }
}

async function main() {
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  const { Pool } = await import("pg");

  console.log("pg-conformance: starting Postgres testcontainer...");
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const connectionString = container.getConnectionUri();
  const pool = new Pool({ connectionString });

  let driverChild;
  try {
    console.log("pg-conformance: starting compliance-driver (pg mode)...");
    driverChild = spawn(
      process.execPath,
      [DRIVER_ENTRY, "--port", "0", "--storage", "pg", "--pg-url", connectionString],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    const port = await waitForDriverPort(driverChild);
    const driverUrl = `http://127.0.0.1:${port}`;
    await waitForDriverReady(driverChild, driverUrl);

    console.log("pg-conformance: running the sender corpus against the pg-backed driver...");
    const suite = await runComplianceBinary(driverUrl);
    check(
      "sender corpus: zero failures against the pg-backed driver",
      suite.summary?.fail === 0,
      JSON.stringify(suite.summary),
    );
    if (suite.summary?.fail > 0) {
      for (const r of suite.results ?? []) {
        if (!r.skipped && !r.pass) console.error(`  FAIL vector ${r.id}: ${r.error ?? ""}`);
      }
    }

    console.log("pg-conformance: asserting DB-schema conformance...");
    await assertColumnShape(pool);
    await assertRowShape(pool);
  } finally {
    if (driverChild) driverChild.kill();
    await pool.end();
    await container.stop();
  }

  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"}: ${failures.length} failing check(s)`);
  for (const f of failures) console.error(f);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("pg-conformance:", err);
  process.exit(1);
});
