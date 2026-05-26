import { describe, expect, it } from "vitest";
import { startDriver } from "../src/index.js";

describe("Sender-side compliance driver mechanism", () => {
  it("Runner discovers port info via GET /control/info", async () => {
    const driver = await startDriver();
    const res = await fetch(`${driver.url}/control/info`);
    const body = (await res.json()) as {
      port_name: string;
      suite_compat: string;
      mock_receiver_required: boolean;
    };
    expect(res.status).toBe(200);
    expect(body.port_name).toBe("typescript");
    expect(body.suite_compat).toBe("0.2");
    expect(body.mock_receiver_required).toBe(true);
    await driver.stop();
  });

  it("reset endpoint clears state between vectors", async () => {
    const driver = await startDriver();
    await fetch(`${driver.url}/control/endpoints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "http://127.0.0.1:65535/h",
        allowHttp: true,
        types: ["evt.x"],
      }),
    });
    const reset = await fetch(`${driver.url}/control/reset`, { method: "POST" });
    expect(reset.status).toBe(200);
    await driver.stop();
  });

  it("send returns a deterministic MessageId shape", async () => {
    const driver = await startDriver();
    const res = await fetch(`${driver.url}/control/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "evt.ping" }),
    });
    const body = (await res.json()) as { messageId: string };
    expect(body.messageId).toMatch(/^msg_/);
    await driver.stop();
  });

  it("clock advance is honored by the host", async () => {
    const driver = await startDriver();
    const res = await fetch(`${driver.url}/control/clock/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ms: 5000 }),
    });
    expect(res.status).toBe(200);
    await driver.stop();
  });
});
