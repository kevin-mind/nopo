import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "@more/configs/vite.js";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { cvaBEMPlugin } from "./src/lib/vite-plugin-cva-bem";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cvaBEMPlugin({
      componentPrefix: "",
      outputPath: "build/bem-components.css",
    }),
    viteStaticCopy({
      targets: [
        {
          src: path.resolve(__dirname, "build/bem-components.css"),
          dest: path.resolve(__dirname, "css"),
        },
      ],
      watch: {
        reloadPageOnChange: true,
      },
    }),
  ],
  build: {
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
