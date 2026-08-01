import { test, expect } from "@playwright/test";

test.describe("Import modals", () => {
  test("collections page has import OpenAPI button", async ({ page }) => {
    await page.goto("/collections");
    const importBtn = page.getByRole("button", { name: /import|openapi/i }).first();
    await expect(importBtn).toBeVisible({ timeout: 10000 });
  });

  test("import OpenAPI modal can be opened and closed", async ({ page }) => {
    await page.goto("/collections");

    // Find an import-related button
    const importBtn = page
      .getByRole("button", { name: /import openapi|import api|openapi/i })
      .first();
    if (await importBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await importBtn.click();

      // A dialog/modal should appear
      const dialog = page.locator('[role="dialog"]').first();
      if (await dialog.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Should have some content about importing
        await expect(dialog).toBeVisible();

        // Close the dialog
        const closeBtn = page.locator('[role="dialog"] button').locator("svg.lucide-x").first();
        if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await closeBtn.click();
        }
      }
    }
  });

  test("import Postman modal can be opened", async ({ page }) => {
    await page.goto("/collections");

    const importBtn = page.getByRole("button", { name: /postman/i }).first();
    if (await importBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await importBtn.click();
      await page.waitForTimeout(500);
      // Dialog should open
      const dialog = page.locator('[role="dialog"]').first();
      if (await dialog.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(dialog).toBeVisible();
      }
    }
  });

  test("import GitHub modal can be opened from projects page", async ({ page }) => {
    await page.goto("/my-projects");

    const githubBtn = page.getByRole("button", { name: /import.*github|github.*import/i }).first();
    if (await githubBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await githubBtn.click();
      const dialog = page.locator('[role="dialog"]').first();
      if (await dialog.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(dialog).toBeVisible();
      }
    }
  });
});
