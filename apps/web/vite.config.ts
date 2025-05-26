import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { stencilSSR } from "@stencil/ssr";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  base: process.env.SERVICE_PUBLIC_PATH || "/",
  plugins: [
    tailwindcss(),
    reactRouter(),
    stencilSSR({
      module: import("@more/ui-react"),
      from: "component-library-react",
      hydrateModule: import("@more/ui/hydrate"),
      serializeShadowRoot: {
        scoped: ["my-component"],
        default: "declarative-shadow-dom",
      },
    }),
    tsconfigPaths({
      root: process.cwd(),
    }),
  ],
  server: {
    port: 3000,
  },
});
