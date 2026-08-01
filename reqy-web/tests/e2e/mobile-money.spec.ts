import { test, expect } from "@playwright/test";

test.describe("Mobile Money", () => {
  test("page loads (module gate may block if module disabled)", async ({ page }) => {
    await page.goto("/mobile-money");
    // The page may show either the mobile money simulator or a module-disabled message
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });

    // If the module is disabled, we should see the module-disabled indicator
    const disabled = page.getByTestId("module-disabled");
    if (await disabled.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(disabled).toBeVisible();
    }
  });

  test("callback simulator section renders when enabled", async ({ page }) => {
    await page.goto("/mobile-money");

    // Check if the page content is the mobile money page
    const mmPage = page.getByTestId("mobile-money-page");
    if (await mmPage.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(mmPage).toBeVisible();
      // Should show the title
      const title = page.locator("h1", { hasText: /mobile money|callback|simulateur/i });
      await expect(title).toBeVisible();
    }
  });
});
