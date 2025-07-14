import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "@more/configs/vite.js";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(() => {
  return {
    plugins: [
      tailwindcss(),
      reactRouter(),
      tsconfigPaths({
        root: process.cwd(),
      }),
    ],
  };
});
