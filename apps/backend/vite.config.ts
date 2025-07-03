import { defineConfig } from "vite";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [
    // Tailwind CSS will be handled through PostCSS for now
  ],
  build: {
    outDir: "static/dist",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/frontend/main.ts"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
    manifest: true,
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    origin: "http://localhost:5173",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
