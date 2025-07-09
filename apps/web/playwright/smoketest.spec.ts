import { test, expect } from "@playwright/test";

test.describe("Smoketest", () => {
  test("home page loads and has a heading", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/");

    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    // Check that the page has an h3 element
    const h3 = page.getByRole("heading", {
      name: "🚀 React Router + Vite Setup Complete!",
    });
    await expect(h3).toBeVisible();

    // Verify the page title is set correctly
    await expect(page).toHaveTitle(/New React Router App/);
  });

  test("visual regression test - full page screenshot", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/");

    // Wait for the page to load completely
    await page.waitForLoadState("networkidle");

    // Take a screenshot of the entire page
    await expect(page).toHaveScreenshot("home-page-full.png");
  });

  test("visual regression test - form interaction", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/");

    // Wait for the page to load completely
    await page.waitForLoadState("networkidle");

    // Fill in the form fields
    await page.fill('input[name="count"]', "5");
    await page.fill('input[name="name"]', "Test User Name");

    // Take a screenshot of the form area
    const formCard = page.getByText("Interactive Demo").locator("..");
    await expect(formCard).toHaveScreenshot("form-filled.png");

    // Submit the form
    await page.click('button[type="submit"]');

    // Wait for the form to be in submitting state
    await page.waitForSelector('button[type="submit"]:disabled');

    // Take a screenshot during submission
    await expect(formCard).toHaveScreenshot("form-submitting.png");
  });
});
