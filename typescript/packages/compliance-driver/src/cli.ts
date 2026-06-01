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
  const shutdown = (): void => {
    driver.stop().then(
      () => process.exit(0),
      (err) => {
        // A failed shutdown must still exit (non-zero) rather than leaving an
        // unhandled rejection and a process that never terminates.
        process.stderr.write(`compliance-driver-ts: shutdown failed: ${(err as Error).message}\n`);
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  process.stderr.write(`compliance-driver-ts: ${(err as Error).message}\n`);
  process.exit(1);
});
