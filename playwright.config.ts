import { defineConfig, devices } from "@playwright/test";
import { z } from "zod";

const {
  data: env,
  success,
  error,
} = z
  .object({
    CI: z
      .string()
      .optional()
      .transform((val) => val === "true" || val === "1"),
    PUBLIC_URL: z.string().url().default("http://localhost"),
  })
  .safeParse(process.env);

if (!success) {
  console.error("Invalid environment variables");
  console.error(error.message);
  process.exit(1);
}

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./apps",
  testMatch: "**/playwright/*.spec.ts",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: env.CI,
  /* Retry on CI only */
  retries: env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: env.CI ? "list" : "html",
  /* Global timeout for entire test run */
  globalTimeout: env.CI ? 5 * 60 * 1000 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: env.PUBLIC_URL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },

    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },

    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
