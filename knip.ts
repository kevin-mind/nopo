import { KnipConfig } from "knip";

export default {
  ignore: [
    "packages/plop/**",
    "packages/configs/**",
    "**/.react-router/**",
    "**/+types/**",
    // E2E test dump directory (Claude automation artifacts)
    "test-e2e-dump/**",
    // E2E test feature directories (mock files created during multi-phase tests)
    "test-feature-*/**",
    // State machine has its own build/test system
    ".github/statemachine/**",
  ],
  workspaces: {
    ".": {
      entry: ["fly/scripts/*.js", ".github/workflows-ts/*.wac.ts"],
      ignoreBinaries: ["dev", "printf"],
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
      entry: ["*/index.ts", "lib/index.ts", "scripts/*.ts"],
      vitest: true,
      ignore: ["*/dist/**"],
      ignoreDependencies: ["@actions/glob", "@actions/io"],
      rules: {
        exports: "off",
      },
    },
  },
} satisfies KnipConfig;
