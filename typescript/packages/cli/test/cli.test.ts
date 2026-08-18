import { describe, expect, it } from "vitest";

import { main } from "../src/cli.js";

// Requirement: `postel migrate` is the only v1 CLI verb
describe("postel binary", () => {
  it("Unsupported command is rejected", async () => {
    await expect(main(["sign"])).rejects.toThrow(/unsupported command "sign"/);
  });

  it("Unsupported command is rejected: no command", async () => {
    await expect(main([])).rejects.toThrow(/unsupported command/);
  });
});
