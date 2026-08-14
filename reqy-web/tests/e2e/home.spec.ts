import { test, expect } from "@playwright/test";

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  // Body is visible (basic smoke test)
  await expect(page.locator("body")).toBeVisible();
});

test("collections page loads", async ({ page }) => {
  await page.goto("/collections");
  await expect(page.locator("body")).toContainText(/collection/i, { timeout: 5000 });
});

test("dashboard page loads", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.locator("body")).toBeVisible();
});
test("responsive shell stays within a narrow viewport", async function ({ page }) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  const overflow = await page.evaluate(function () {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});
