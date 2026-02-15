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
    "packages/issue-state": {
      ignore: ["scripts/**"],
    },
    "packages/prompts": {
      entry: ["scripts/*.ts"],
      // dist/ and prompts/ are build outputs; components.tsx exports are used via JSX
      // which knip can't trace (custom JSX runtime, not React)
      ignore: ["dist/**", "prompts/**", "src/components.tsx"],
    },
    "packages/claude": {
      entry: ["src/index.ts", "actions/claude/index.ts"],
      ignore: ["actions/claude/dist/**"],
      ignoreDependencies: ["@more/prompt-factory", "esbuild"],
    },
    "packages/mock-factory": {},
    "packages/statemachine": {
      // Actions are standalone entry points compiled by esbuild
      entry: [
        "actions/*/index.ts",
        "actions/*/post.ts",
        "actions/*/lib/**/*.ts",
        "scripts/*.ts",
      ],
      ignore: ["actions/*/dist/**"],
      // Internal module re-exports needed for TS declaration emit
      rules: {
        exports: "off",
      },
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
