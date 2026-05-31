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

  it("a private-IP endpoint is rejected at registration with a structured 422 error_code", async () => {
    const driver = await startDriver();
    const res = await fetch(`${driver.url}/control/endpoints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://10.0.0.5/hook", allowHttp: true, types: ["evt.x"] }),
    });
    expect(res.status).toBe(422);
    expect(res.headers.get("x-postel-verify-error")).toBe("ENDPOINT_VALIDATION");
    const body = (await res.json()) as { error_code: string };
    expect(body.error_code).toBe("ENDPOINT_VALIDATION");
    await driver.stop();
  });
});
