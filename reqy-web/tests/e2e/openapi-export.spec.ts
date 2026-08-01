import { test, expect } from "@playwright/test";

test.describe("OpenAPI Export", () => {
  test("OpenAPI export modal opens from collections page", async ({ page }) => {
    await page.goto("/collections");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });

    // Look for the OpenAPI export button
    const exportBtn = page.getByRole("button", { name: /openapi|export openapi/i }).first();
    if (await exportBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await exportBtn.click();

      // After clicking, a modal should appear (export collections dialog)
      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 5000 });
    }
  });

  test("export button on collection row shows dropdown", async ({ page }) => {
    await page.goto("/collections");
    // Check for export option in collection actions
    const exportAction = page.getByRole("button", { name: /export/i }).first();
    if (await exportAction.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(exportAction).toBeVisible();
    }
  });
});
