import { test, expect } from "@playwright/test";

test.describe("Smoketest", () => {
  test("home page loads, renders user info, and vite button is interactive", async ({
    page,
  }) => {
    // Navigate to the home page
    await page.goto("/api");

    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    const text = page.getByText("John Doe");
    await expect(text).toBeVisible();

    // Find the button by its ID
    const viteButton = page.locator("#vite-button");

    // Ensure the button is visible and has the correct initial text
    await expect(viteButton).toBeVisible();
    await expect(viteButton).toHaveText("Click me!");

    // Click the button
    await viteButton.click();

    // Assert that the button's text has been updated
    await expect(viteButton).toHaveText("Clicked!");
  });
});
