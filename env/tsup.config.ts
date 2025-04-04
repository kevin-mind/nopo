import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  target: "esnext",
  format: "esm",
  outDir: "build",
  entry: ["src/index.ts"],
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: !options.watch,
  dts: true,
}));
