import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  platform: "node",
  external: ["@postel/core", "@postel/storage-helpers", "mysql2", "mysql2/promise"],
  treeshake: true,
});
