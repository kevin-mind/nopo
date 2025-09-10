import { KnipConfig } from "knip";

export default {
  ignore: ["packages/plop/**", "packages/configs/**"],
  workspaces: {
    ".": {
      entry: ["fly/scripts/*.js"],
      ignoreBinaries: ["dev"],
      ignoreDependencies: ["tsx"],
    },
    "docker/scripts": {
      entry: "bin.ts",
    },
    "apps/backend": {
      tailwind: true,
      vitest: true,
      entry: "assets/js/main.ts",
      ignoreDependencies: ["@more/ui", "tailwindcss"],
      ignoreBinaries: ["uv"],
    },
    "apps/web": {
      "react-router": true,
    },
    "packages/config": {
      eslint: false,
    },
    "packages/ui": {
      storybook: true,
      ignoreDependencies: ["tw-animate-css"],
    },
    "nopo/scripts": {
      entry: "bin.ts",
    },
  },
} satisfies KnipConfig;
