import { Postel, Secret, signFixture } from "@postel/core";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { expressAdapter, verifyWebhook } from "../src/index.js";

const SECRET = "whsec_aG9uby1hZGFwdGVyLXRlc3Qtc2VjcmV0LWZvci1wb3N0ZWw=";
const NOW = new Date("2026-05-14T13:00:00Z");

function vendor() {
  return Postel({ inbound: { vendor: { verify: Secret(SECRET), now: () => NOW } } });
}

function signed(type: string, id: string) {
  return signFixture({
    secret: SECRET,
    payload: { type, timestamp: "2026-05-14T12:59:55Z", data: { id } },
    timestamp: NOW,
  });
}

describe("Framework adapters preserve raw bytes", () => {
  it("Express adapter preserves bytes: verifyWebhook receives byte-identical input and runs the handler", async () => {
    const postel = vendor();
    const app = express();
    app.post("/webhooks/vendor", verifyWebhook(postel.inbound.vendor), (req, res) => {
      res.json({ ok: true, type: req.postel?.event.type });
    });
    const sig = await signed("order.created", "o_1");
    const res = await request(app)
      .post("/webhooks/vendor")
      .set(sig.headers)
      .set("content-type", "application/json")
      .send(sig.body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, type: "order.created" });
  });

  it("re-serialized JSON breaks the signature (400) and the handler never runs", async () => {
    const postel = vendor();
    let ran = false;
    const app = express();
    app.post("/webhooks/vendor", expressAdapter(postel).verify("vendor"), (_req, res) => {
      ran = true;
      res.json({ ok: true });
    });
    const sig = await signed("order.created", "o_2");
    const reSerialized = JSON.stringify(JSON.parse(sig.body), null, 2);
    const res = await request(app)
      .post("/webhooks/vendor")
      .set(sig.headers)
      .set("content-type", "application/json")
      .send(reSerialized);
    expect(res.status).toBe(400);
    expect(ran).toBe(false);
    expect(res.body).toMatchObject({ error: { code: "SIGNATURE_INVALID" } });
  });
});
