#!/usr/bin/env node
import { startDriver } from "./server.js";

async function main(): Promise<void> {
  let port = 0;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--port") {
      const v = process.argv[i + 1];
      if (v !== undefined) port = Number.parseInt(v, 10);
    }
  }
  const driver = await startDriver({ port });
  process.stdout.write(`${JSON.stringify({ port: driver.port, pid: process.pid })}\n`);
  process.on("SIGTERM", () => {
    void driver.stop().then(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    void driver.stop().then(() => process.exit(0));
  });
}

main().catch((err) => {
  process.stderr.write(`compliance-driver-ts: ${(err as Error).message}\n`);
  process.exit(1);
});
