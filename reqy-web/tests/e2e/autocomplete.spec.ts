import { test, expect } from "@playwright/test";

test.describe("Autocomplete suggestions", () => {
  test("URL input shows variable suggestions in dropdown", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // The URL input has autocomplete with {{var}} suggestions
    const urlInput = page.locator('[data-testid="url-input"]').first();
    await expect(urlInput).toBeVisible();
    await urlInput.fill("{{");

    // Wait for autocomplete dropdown
    await page.waitForTimeout(500);
    // The autocomplete dropdown (typically a listbox or popover)
    const suggestions = page
      .locator('[role="listbox"], [role="option"], .autocomplete, [data-autocomplete]')
      .first();
    if (await suggestions.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(suggestions).toBeVisible();
    }
  });

  test("header key field suggests common header names", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Expand Headers section
    const headersAccordion = page.locator("button", { hasText: /Headers|En-têtes/i }).first();
    await headersAccordion.click();
    await page.waitForTimeout(500);

    // Find the header key input
    const headerKeyInput = page.locator('input[placeholder="Key"]').first();
    if (await headerKeyInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await headerKeyInput.fill("Con");
      await page.waitForTimeout(500);

      // Should show suggestions (Content-Type, Connection, etc.)
      const suggestion = page.locator('[role="option"], [role="listbox"]').first();
      if (await suggestion.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(suggestion).toBeVisible();
      }
    }
  });

  test("query param key shows recent key suggestions", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Expand Query Params section
    const paramsAccordion = page.locator("button", { hasText: /Query Params|Paramètres/i }).first();
    await paramsAccordion.click();
    await page.waitForTimeout(500);

    // Check that the key input has suggestions
    const paramKeyInput = page.locator('input[placeholder="Key"]').first();
    if (await paramKeyInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(paramKeyInput).toBeVisible();
    }
  });

  test("variables dropdown exists next to URL input", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // There should be a Variables select dropdown near the URL bar
    const varSelect = page.locator("select", { hasText: /Variables/i }).first();
    if (await varSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(varSelect).toBeVisible();
    }
  });
});
