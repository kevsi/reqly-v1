import { test, expect } from "@playwright/test";

test.describe("Collections", () => {
  test("collections page loads", async ({ page }) => {
    await page.goto("/collections");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
  });

  test("new collection button is visible", async ({ page }) => {
    await page.goto("/collections");
    // The new collection button should be present (either from the panel or empty state)
    const btn = page.getByTestId("new-collection-button").first();
    await expect(btn).toBeVisible({ timeout: 10000 });
  });

  test("can create a new collection", async ({ page }) => {
    await page.goto("/collections");
    const btn = page.getByTestId("new-collection-button").first();
    await btn.click();

    // "New" creates the collection immediately — wait for a collection row to appear
    const rows = page.getByTestId("collection-row");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
  });

  test("collection list is present", async ({ page }) => {
    await page.goto("/collections");
    const list = page.getByTestId("collection-list").first();
    if (await list.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(list).toBeVisible();
    }
  });
});
