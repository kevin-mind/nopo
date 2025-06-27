import { test, expect } from "@playwright/test";

test.describe("Smoketest", () => {
  test("home page loads and has h1 element", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/api");

    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    const text = page.getByText("Hello, World!");
    await expect(text).toBeVisible();
  });
});
