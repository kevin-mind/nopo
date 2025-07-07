import { test, expect } from "@playwright/test";

test.describe("Smoketest", () => {
  test("home page loads and renders user info from partial", async ({
    page,
  }) => {
    // Navigate to the home page
    await page.goto("/api");

    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    const text = page.getByText("John Doe");
    await expect(text).toBeVisible();
  });
});
