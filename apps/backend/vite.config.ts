import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const servicePublicPath = env.SERVICE_PUBLIC_PATH || "/";
  const staticUrl = `${servicePublicPath}/static/`.replace(/\/\//g, "/");
  const viteBaseUrl = `${staticUrl}vite/`.replace(/\/\//g, "/");

  console.log("viteBaseUrl", viteBaseUrl);

  return {
    base: viteBaseUrl,
    root: resolve(__dirname, "assets"),
    build: {
      outDir: resolve(__dirname, "assets", "dist"),
      manifest: true,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, "assets/js/main.ts"),
          style: resolve(__dirname, "assets/css/main.css"),
        },
      },
      minify: process.env.NODE_ENV === "production",
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
