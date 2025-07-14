import { defineConfig, loadEnv } from "@more/configs/vite.js";
import { resolve } from "path";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(() => {

  const staticUrl = `/static/`.replace(/\/\//g, "/");
  const viteBaseUrl = `${staticUrl}vite/`.replace(/\/\//g, "/");

  return {
    base: viteBaseUrl,
    root: resolve(__dirname, "assets"),
    plugins: [tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "assets/js/main.ts"),
          style: resolve(__dirname, "assets/css/tailwind.css"),
        },
      },
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "assets"),
      },
    },
    css: {
      devSourcemap: true,
    },
  };
});
