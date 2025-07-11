import { defineConfig } from "vite";
import { resolve } from "node:path";

import pkg from "./package.json";

export default defineConfig({
  build: {
    outDir: "build",
    emptyOutDir: true,
    ssr: true,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: pkg.name,
      fileName: "index",
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        "node:child_process",
        "node:fs",
        "node:path",
        "node:url",
        "node:net",
        "node:process",
      ],
      output: {
        format: "cjs",
        entryFileNames: "[name].js",
        preserveModules: true,
      },
    },
    minify: false,
    sourcemap: false,
  },
});
