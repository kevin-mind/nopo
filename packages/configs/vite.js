import { resolve, dirname, basename } from "node:path";
import { defineConfig as _defineConfig, mergeConfig, loadEnv } from "vite";

export function defineConfig(overrides = {}) {
  const cwd = process.cwd();
  const name = basename(cwd);
  const packageType = basename(dirname(cwd));
  const entry = resolve(cwd, "src", "index.ts")

  const config = _defineConfig(({ mode }) => {
    const env = loadEnv(mode, cwd, "");
    const config = {
      build: {
        minify: mode === "production",
        outDir: resolve(cwd, "build"),
        emptyOutDir: true,
        manifest: true,
      }
    };

    if (packageType === "packages") {
      config.build.lib = {
        entry,
        name,
        formats: ["es", "umd"],
        fileName: (format, entryName) => `${entryName}.${format}.js`,
      };
    }

    if (packageType === "apps") {
      config.server = {
        host: true,
        port: env.PORT ? parseInt(env.PORT) : 80,
        allowedHosts: true,
        origin: env?.SITE_URL ?? "127.0.0.1",
        strictPort: true,
      };
    }

    return mergeConfig(
      config,
      typeof overrides === "function" ? overrides(env) : overrides,
    );
  });

  return config;
}

export { loadEnv } from "vite";
