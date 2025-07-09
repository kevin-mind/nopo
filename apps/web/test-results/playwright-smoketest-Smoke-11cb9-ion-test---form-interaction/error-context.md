# Test info

- Name: Smoketest >> visual regression test - form interaction
- Location: /workspace/apps/web/playwright/smoketest.spec.ts:32:3

# Error details

```
Error: browserType.launch: Executable doesn't exist at /home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1169/chrome-linux/headless_shell
╔═════════════════════════════════════════════════════════════════════════╗
║ Looks like Playwright Test or Playwright was just installed or updated. ║
║ Please run the following command to download new browsers:              ║
║                                                                         ║
║     pnpm exec playwright install                                        ║
║                                                                         ║
║ <3 Playwright Team                                                      ║
╚═════════════════════════════════════════════════════════════════════════╝
```

# Test source

```ts
   1 | import { test, expect } from "@playwright/test";
   2 |
   3 | test.describe("Smoketest", () => {
   4 |   test("home page loads and has a heading", async ({ page }) => {
   5 |     // Navigate to the home page
   6 |     await page.goto("/");
   7 |
   8 |     // Wait for the page to load
   9 |     await page.waitForLoadState("networkidle");
  10 |
  11 |     // Check that the page has an h3 element
  12 |     const h3 = page.getByRole("heading", {
  13 |       name: "🚀 React Router + Vite Setup Complete!",
  14 |     });
  15 |     await expect(h3).toBeVisible();
  16 |
  17 |     // Verify the page title is set correctly
  18 |     await expect(page).toHaveTitle(/New React Router App/);
  19 |   });
  20 |
  21 |   test("visual regression test - full page screenshot", async ({ page }) => {
  22 |     // Navigate to the home page
  23 |     await page.goto("/");
  24 |
  25 |     // Wait for the page to load completely
  26 |     await page.waitForLoadState("networkidle");
  27 |
  28 |     // Take a screenshot of the entire page
  29 |     await expect(page).toHaveScreenshot("home-page-full.png");
  30 |   });
  31 |
> 32 |   test("visual regression test - form interaction", async ({ page }) => {
     |   ^ Error: browserType.launch: Executable doesn't exist at /home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1169/chrome-linux/headless_shell
  33 |     // Navigate to the home page
  34 |     await page.goto("/");
  35 |
  36 |     // Wait for the page to load completely
  37 |     await page.waitForLoadState("networkidle");
  38 |
  39 |     // Fill in the form fields
  40 |     await page.fill('input[name="count"]', "5");
  41 |     await page.fill('input[name="name"]', "Test User Name");
  42 |
  43 |     // Take a screenshot of the form area
  44 |     const formCard = page.getByText("Interactive Demo").locator("..");
  45 |     await expect(formCard).toHaveScreenshot("form-filled.png");
  46 |
  47 |     // Submit the form
  48 |     await page.click('button[type="submit"]');
  49 |
  50 |     // Wait for the form to be in submitting state
  51 |     await page.waitForSelector('button[type="submit"]:disabled');
  52 |
  53 |     // Take a screenshot during submission
  54 |     await expect(formCard).toHaveScreenshot("form-submitting.png");
  55 |   });
  56 | });
  57 |
```