import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/worker.ts", "src/core/index.ts", "src/utils/index.ts", "src/handlers/index.ts", "src/types/index.ts"],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  target: "es2022",
  format: ["cjs", "esm"],
});
