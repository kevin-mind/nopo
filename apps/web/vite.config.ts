import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      tailwindcss(),
      reactRouter(),
      tsconfigPaths({
        root: process.cwd(),
      }),
    ],
    server: {
      port: env.PORT ? parseInt(env.PORT) : 5173,
    },
  };
});
