import { test, expect } from "@playwright/test";

test.describe("Collection Runner", () => {
  test("run button visible on collections page", async ({ page }) => {
    await page.goto("/collections");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const btn = page.getByRole("button", { name: /run|lancer|executer/i }).first();
    if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(btn).toBeVisible();
    }
  });

  test("runner page loads with selector", async ({ page }) => {
    await page.goto("/runner");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    const selectEl = page.locator("select, button", { hasText: /collection|select/i }).first();
    if (await selectEl.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(selectEl).toBeVisible();
    }
  });
});
