import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    env: {
      // Prevent setupGit/prepareBranch from running real git commands in CI.
      // Tests exercise routing + PEV logic; git operations are tested via
      // integration in the actual workflow.
      GITHUB_ACTIONS: "",
    },
  },
});
