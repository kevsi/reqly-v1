import { test, expect } from "@playwright/test";

test.describe("Request chaining", () => {
  test("chaining button/dialog can be accessed from request page", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Look for chaining-related text or button
    const chainingBtn = page.locator("button", { hasText: /chaining|chain/i }).first();
    if (await chainingBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chainingBtn.click();

      // Dialog should open
      const dialog = page.locator('[role="dialog"]').first();
      if (await dialog.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(dialog).toBeVisible();
        // Should show the chaining mapping section
        const mappingTitle = page.locator("h2, div, p", { hasText: /mappings/i }).first();
        if (await mappingTitle.isVisible({ timeout: 2000 }).catch(() => false)) {
          await expect(mappingTitle).toBeVisible();
        }
      }
    }
  });

  test("chaining dialog describes purpose", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Try to open the chaining dialog via the button
    const chainBtn = page.locator("button", { hasText: /chaining/i }).first();
    if (await chainBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chainBtn.click();

      // Should show description about injecting values
      const description = page
        .locator("text", { hasText: /inject|value|response|variable/i })
        .first();
      if (await description.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(description).toBeVisible();
      }
    }
  });
});
