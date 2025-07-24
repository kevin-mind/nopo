import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const staticUrl = `/static/`.replace(/\/\//g, "/");
  const viteBaseUrl = `${staticUrl}vite/`.replace(/\/\//g, "/");

  return {
    base: viteBaseUrl,
    root: resolve(__dirname, "assets"),
    plugins: [tailwindcss()],
    build: {
      outDir: resolve(__dirname, "build"),
      manifest: true,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, "assets/js/main.ts"),
          style: resolve(__dirname, "assets/css/tailwind.css"),
        },
      },
      minify: env.NODE_ENV === "production",
    },
    server: {
      host: true,
      port: env.PORT ? parseInt(env.PORT) : 80,
      allowedHosts: true,
      origin: env?.SITE_URL ?? "127.0.0.1",
      strictPort: true,
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
