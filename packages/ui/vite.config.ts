import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        {
          src: path.resolve(__dirname, "src/lib/theme.css"),
          dest: "./",
        },
      ],
      watch: {
        reloadPageOnChange: true,
      },
    }),
  ],
  build: {
    minify: true,
    outDir: "build",
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "ui",
      formats: ["es", "umd"],
      fileName: (format, entryName) => `${entryName}.${format}.js`,
    },
    rollupOptions: {
      external: ["react", "react/jsx-runtime", "react-dom", "tailwindcss"],
      output: {
        globals: {
          react: "React",
          "react/jsx-runtime": "react/jsx-runtime",
          "react-dom": "ReactDOM",
          tailwindcss: "tailwindcss",
        },
      },
    },
  },
});
