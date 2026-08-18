#!/usr/bin/env node
import { runMigrate } from "./migrate.js";

export async function main(argv: ReadonlyArray<string>): Promise<void> {
  const [command, ...rest] = argv;
  if (command !== "migrate") {
    throw new Error(`unsupported command "${command ?? ""}" (only "migrate" is supported)`);
  }
  await runMigrate(rest);
}

// Only run when invoked directly (`postel ...`), not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (err) => {
      process.stderr.write(`postel: ${(err as Error).message}\n`);
      process.exit(1);
    },
  );
}
