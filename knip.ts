import { KnipConfig } from "knip";

export default {
  ignore: [
    "packages/plop/**",
    "packages/configs/**",
    "**/.react-router/**",
    "**/+types/**",
    // Test feature files created by Claude automation
    "test-feature-*/**",
  ],
  workspaces: {
    ".": {
      entry: ["fly/scripts/*.js", ".github/workflows-ts/*.wac.ts"],
      ignoreBinaries: ["dev"],
      ignoreDependencies: ["tsx"],
      ignoreUnresolved: [".*\\+types.*"],
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
      ignoreUnresolved: [".*\\+types.*"],
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
    ".github/actions-ts": {
      entry: ["*/index.ts", "lib/index.ts", "scripts/*.ts", "*/scripts/*.ts"],
      vitest: true,
      ignore: ["*/dist/**"],
      ignoreDependencies: ["@actions/glob", "@actions/io"],
    },
  },
} satisfies KnipConfig;
