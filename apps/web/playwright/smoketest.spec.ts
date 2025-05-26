import { test, expect } from "@playwright/test";

test.describe("Smoketest", () => {
  test("home page loads and has h1 element", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/web");

    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    // Check that the page has an h1 element
    const h1 = page.locator("h1");
    await expect(h1).toBeVisible();

    // Verify the page title is set correctly
    await expect(page).toHaveTitle(/New React Router App/);
  });
});
