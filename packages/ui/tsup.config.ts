import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: ["src/*.ts"],
  outDir: "build",
  target: "esnext",
  platform: "neutral",
  format: "esm",
  treeshake: false,
  sourcemap: true,
  clean: true,
  minify: !options.watch,
}));
