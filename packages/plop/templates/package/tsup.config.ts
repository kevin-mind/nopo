import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "build",
  format: ["esm", "cjs"],
  splitting: false,
  clean: true,
});
