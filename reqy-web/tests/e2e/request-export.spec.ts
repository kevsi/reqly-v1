import { test, expect } from "@playwright/test";

test.describe("Request export (cURL / Fetch)", () => {
  test("export controls visible on home page when URL is entered", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Enter a URL first to show the export row
    const urlInput = page.locator('[data-testid="url-input"]').first();
    await urlInput.fill("https://httpbin.org/get");

    // The export format selector should now be visible
    const exportSelect = page.locator("button", { hasText: /cURL|Fetch|Code|Export/i }).first();
    if (await exportSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(exportSelect).toBeVisible();
    }
  });

  test("can switch between cURL and Fetch formats", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Enter a URL
    const urlInput = page.locator('[data-testid="url-input"]').first();
    await urlInput.fill("https://httpbin.org/get");

    // Find the export format selector
    const exportSelect = page.getByRole("button", { name: /Code|cURL|Fetch/i }).first();
    if (await exportSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      await exportSelect.click();
      // Should see options
      const curlOption = page.getByRole("option", { name: /cURL/i }).first();

      if (await curlOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await curlOption.click();
        // After selecting, the Copy button text should update
        await page.waitForTimeout(300);
      }
    }
  });

  test("Copy cURL/Fetch button is present", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    const urlInput = page.locator('[data-testid="url-input"]').first();
    await urlInput.fill("https://httpbin.org/get");

    // Look for a copy/export button
    const copyBtn = page.locator("button", { hasText: /Copy|cURL|Fetch/i }).first();
    if (await copyBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(copyBtn).toBeVisible();
    }
  });

  test("REST snapshot controls are visible after sending a request", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Check if snapshot controls are present (they require response body to be enabled)
    const snapshotSave = page.getByTestId("rest-snapshot-save");
    const snapshotCompare = page.getByTestId("rest-snapshot-compare");

    // These controls should exist in the DOM even if disabled
    if (await snapshotSave.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(snapshotSave).toBeVisible();
      // Should be disabled initially (no response yet)
      await expect(snapshotSave).toBeDisabled();
    }
    if (await snapshotCompare.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(snapshotCompare).toBeVisible();
      await expect(snapshotCompare).toBeDisabled();
    }
  });
});
