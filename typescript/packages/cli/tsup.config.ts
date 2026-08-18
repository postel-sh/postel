import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  platform: "node",
  external: ["@postel/pg", "@postel/sqlite", "@postel/mysql", "pg", "better-sqlite3", "mysql2"],
  treeshake: true,
});
