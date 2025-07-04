import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

import env from "./env";

export default defineConfig({
  base: env.SERVICE_PUBLIC_PATH || "/",
  plugins: [
    tailwindcss(),
    reactRouter(),
    tsconfigPaths({
      root: process.cwd(),
    }),
  ],
  server: {
    port: env.PORT,
  },
});
