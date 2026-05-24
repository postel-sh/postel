#!/usr/bin/env node
//
// typescript/scripts/smoke-receiver.mjs
//
// Self-contained smoke test for `typescript/scripts/reference-receiver.mjs`.
// Boots the receiver in a child process, signs a few payloads with
// `@postel/core`'s signFixture helper, drives the receiver over HTTP, and
// asserts the verdicts that the compliance suite will eventually assert.
//
// Used by CI before invoking the full `@postel/compliance` runner: a quick
// proof that the wiring is intact even when Track A's vectors aren't checked
// in yet. Exits non-zero on any unexpected response.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { signFixture } from "@postel/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RECEIVER_PATH = resolve(__dirname, "reference-receiver.mjs");

const SECRET = "whsec_c21va2UtdGVzdC1mb3ItdGhlLXJlZmVyZW5jZS1yZWNlaXZlcg==";
const PORT = 8788;
const URL_BASE = `http://127.0.0.1:${PORT}`;

const failures = [];

function check(name, condition, detail = "") {
  if (!condition) failures.push(`FAIL: ${name} — ${detail}`);
  else console.log(`ok: ${name}`);
}

async function waitForReady(child) {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${URL_BASE}/.well-known/webhooks-keys`);
      if (res.status !== undefined) return;
    } catch {
      // server not up yet
    }
    if (child.exitCode !== null) {
      throw new Error(`receiver exited prematurely with code ${child.exitCode}`);
    }
    await sleep(100);
  }
  throw new Error("receiver did not become ready within 5s");
}

async function postSigned(body, headers) {
  return fetch(`${URL_BASE}/webhooks`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body,
  });
}

async function main() {
  const child = spawn(process.execPath, [RECEIVER_PATH], {
    env: {
      ...process.env,
      PORT: String(PORT),
      POSTEL_SECRETS: SECRET,
      POSTEL_DEDUP: "true",
      POSTEL_TOLERANCE: "300",
      POSTEL_NOW: "2026-05-14T16:00:00Z",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  try {
    await waitForReady(child);

    const now = new Date("2026-05-14T16:00:00Z");

    const signed = await signFixture({
      secret: SECRET,
      payload: { type: "smoke.ok", timestamp: "2026-05-14T15:59:55Z", data: { ok: true } },
      timestamp: now,
    });

    {
      const res = await postSigned(signed.body, signed.headers);
      check("happy-path POST returns 200", res.status === 200, `got ${res.status}`);
      const body = (await res.json()) ?? {};
      check("happy-path body has type=smoke.ok", body.type === "smoke.ok");
    }

    {
      const tampered = signed.body.replace("smoke.ok", "smoke.bad");
      const res = await postSigned(tampered, signed.headers);
      check("tampered body returns 400", res.status === 400, `got ${res.status}`);
      check(
        "tampered body emits X-Postel-Verify-Error: SIGNATURE_INVALID",
        res.headers.get("x-postel-verify-error") === "SIGNATURE_INVALID",
        `header was ${res.headers.get("x-postel-verify-error")}`,
      );
    }

    {
      const stale = await signFixture({
        secret: SECRET,
        payload: { type: "smoke.stale", timestamp: "2026-05-14T15:00:00Z", data: {} },
        timestamp: new Date("2026-05-14T15:00:00Z"),
      });
      const res = await postSigned(stale.body, stale.headers);
      check("stale timestamp returns 400", res.status === 400);
      check(
        "stale timestamp emits X-Postel-Verify-Error: TIMESTAMP_TOO_OLD",
        res.headers.get("x-postel-verify-error") === "TIMESTAMP_TOO_OLD",
      );
    }

    {
      const second = await postSigned(signed.body, signed.headers);
      check(
        "replay within dedup TTL returns 200 + X-Postel-Dedup-Result: duplicate",
        second.status === 200 && second.headers.get("x-postel-dedup-result") === "duplicate",
        `status=${second.status}, dedup=${second.headers.get("x-postel-dedup-result")}`,
      );
    }
  } finally {
    child.kill("SIGTERM");
  }

  if (failures.length > 0) {
    console.error("\n--- smoke failures ---");
    for (const f of failures) console.error(f);
    process.exit(1);
  }
  console.log("\nsmoke-receiver: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
