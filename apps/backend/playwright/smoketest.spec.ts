import { test, expect } from "@playwright/test";

test.describe("Backend Smoketest", () => {
  test("backend health check with web components", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/api");

    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    // Check that the page loads successfully
    await expect(page.locator("h1")).toContainText("Django with Lit Element");

    // Check that web components are present
    const moreComponents = page.locator("more-component");
    await expect(moreComponents).toHaveCount(2); // Primary and Secondary

    // Test component default content
    await expect(moreComponents.first()).toContainText("Hello, World!");
    await expect(moreComponents.first()).toContainText("Click Count: 0");

    // Test component interaction - click the button to increment count
    const firstComponentButton = moreComponents.first().locator("button");
    await firstComponentButton.click();
    await expect(moreComponents.first()).toContainText("Click Count: 1");

    // Click again to verify counting works
    await firstComponentButton.click();
    await expect(moreComponents.first()).toContainText("Click Count: 2");
  });

  test("web components work with JavaScript disabled", async ({ browser }) => {
    // Create a new context with JavaScript disabled
    const context = await browser.newContext({
      javaScriptEnabled: false,
    });

    const page = await context.newPage();

    // Navigate to the home page
    await page.goto("/api");

    // Check that the page structure is still intact (server-rendered)
    await expect(page.locator("h1")).toContainText("Django with Lit Element");

    // Check that web components are present in the DOM
    const moreComponents = page.locator("more-component");
    await expect(moreComponents).toHaveCount(2);

    // Verify component attributes are present (name property)
    await expect(moreComponents.first()).toHaveAttribute("name", "World");
    await expect(moreComponents.nth(1)).toHaveAttribute("name", "World");

    // Verify initial content is rendered
    await expect(moreComponents.first()).toContainText("Hello, World!");
    await expect(moreComponents.first()).toContainText("Click Count: 0");

    await context.close();
  });

  test("CSS styles are applied", async ({ page }) => {
    await page.goto("/api");
    await page.waitForLoadState("networkidle");

    // Check that the main container has styling
    const container = page.locator(".container");
    await expect(container).toBeVisible();

    const header = page.locator(".header");
    await expect(header).toBeVisible();

    // Check that web components have their internal styling
    const moreComponents = page.locator("more-component");
    await expect(moreComponents.first()).toBeVisible();

    // Verify the button inside the component is styled
    const componentButton = moreComponents.first().locator("button");
    await expect(componentButton).toBeVisible();

    // Check that the page has a proper background color (not default white)
    const body = page.locator("body");
    const backgroundColor = await body.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor,
    );

    // Should not be the default white background
    expect(backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(backgroundColor).not.toBe("rgb(255, 255, 255)");
  });
});
