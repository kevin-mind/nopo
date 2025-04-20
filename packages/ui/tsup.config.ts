import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: ["src/index.ts"],
  outDir: "build",
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: !options.watch,
}));
