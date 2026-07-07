import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signFixture, verify } from "../src/index.js";

const fixedClock = (at: Date) => ({ now: () => at, sleep: () => Promise.resolve() });

const SECRET = "whsec_dGVzdC1zZWNyZXQtZWxpZGUtYm9keS1mb3ItbG9ncw==";
const NOW = new Date("2026-05-14T12:00:00Z");

describe("No payload contents in logs by default", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verify() does not log the payload body on success", async () => {
    const signed = await signFixture({
      secret: SECRET,
      payload: {
        type: "secret.event",
        timestamp: "2026-05-14T11:59:55Z",
        data: { secret_value: "should-never-appear-in-logs" },
      },
      timestamp: NOW,
    });

    const result = await verify(signed.body, signed.headers, SECRET, { clock: fixedClock(NOW) });

    const allCalls = [
      ...infoSpy.mock.calls,
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
      ...debugSpy.mock.calls,
    ];
    const flattened = JSON.stringify(allCalls);
    expect(flattened).not.toContain("should-never-appear-in-logs");
    expect(result.event.type).toBe("secret.event");
  });

  it("verify() does not log the payload body on signature failure", async () => {
    const signed = await signFixture({
      secret: SECRET,
      payload: {
        type: "secret.event",
        timestamp: "2026-05-14T11:59:55Z",
        data: { secret_value: "also-should-never-appear" },
      },
      timestamp: NOW,
    });

    await expect(
      verify(signed.body.replace("secret.event", "tampered"), signed.headers, SECRET, {
        clock: fixedClock(NOW),
      }),
    ).rejects.toBeDefined();

    const allCalls = [
      ...infoSpy.mock.calls,
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
      ...debugSpy.mock.calls,
    ];
    const flattened = JSON.stringify(allCalls);
    expect(flattened).not.toContain("also-should-never-appear");
  });
});
