import { test, expect } from "@playwright/test";

test.describe("Smoketest", () => {
  test("home page loads and has h1 element", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/");

    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    // Check that the page has an h1 element
    const h1 = page.locator("h1");
    await expect(h1).toBeVisible();

    // Verify the page title is set correctly
    await expect(page).toHaveTitle(/New React Router App/);
  });

  test("web components are present and functional", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/");

    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    // Check that web components are present
    const moreComponent = page.locator("more-component");
    await expect(moreComponent).toBeVisible();

    // Test component default content
    await expect(moreComponent).toContainText("Hello, World!");
    await expect(moreComponent).toContainText("Click Count: 0");

    // Test component interaction - click the button to increment count
    const componentButton = moreComponent.locator("button");
    await componentButton.click();
    await expect(moreComponent).toContainText("Click Count: 1");

    // Click again to verify counting works
    await componentButton.click();
    await expect(moreComponent).toContainText("Click Count: 2");
  });

  test("web components work with JavaScript disabled", async ({ browser }) => {
    // Create a new context with JavaScript disabled
    const context = await browser.newContext({
      javaScriptEnabled: false,
    });

    const page = await context.newPage();

    // Navigate to the home page
    await page.goto("/");

    // Check that web components are still present in the DOM (server-rendered)
    const moreComponent = page.locator("more-component");
    await expect(moreComponent).toBeAttached();

    // Verify that the web component has default attributes
    await expect(moreComponent).toHaveAttribute("name", "World");
    await expect(moreComponent).toHaveAttribute("count", "0");

    // Verify initial content is rendered
    await expect(moreComponent).toContainText("Hello, World!");
    await expect(moreComponent).toContainText("Click Count: 0");

    await context.close();
  });

  test("web component with custom name property", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/");

    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    // Find component and update its name property
    const moreComponent = page.locator("more-component");
    await expect(moreComponent).toBeVisible();

    // Set custom name via JavaScript
    await page.evaluate(() => {
      const component = document.querySelector(
        "more-component",
      ) as HTMLElement & { name: string };
      if (component) {
        component.name = "Test User";
      }
    });

    // Verify the updated name is reflected
    await expect(moreComponent).toContainText("Hello, Test User!");
  });
});
