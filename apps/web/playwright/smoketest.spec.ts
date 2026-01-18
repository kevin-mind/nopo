import { test, expect } from "@playwright/test";

test.describe("Smoketest", () => {
  test("home page loads and has a heading", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.waitForLoadState("load");

    // Check that the page has an h3 element
    const h3 = page.getByRole("heading", {
      name: "🚀 React Router + Vite Setup Complete!",
    });
    await expect(h3).toBeVisible();

    // Verify the page title is set correctly
    await expect(page).toHaveTitle(/New React Router App/);
  });

  test("header logo link has aria-label for accessibility", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");

    // Verify the header logo link exists with the correct aria-label
    const logoLink = page.getByRole("link", { name: "Go to homepage" });
    await expect(logoLink).toBeVisible();
    await expect(logoLink).toHaveAttribute("href", "/");
  });
});
