import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  base: process.env.SERVICE_PUBLIC_PATH || "/",
  plugins: [
    tailwindcss(),
    reactRouter(),
    tsconfigPaths({
      root: process.cwd(),
    }),
  ],
  server: {
    port: 3000,
  },
});
