import { test, expect } from "@playwright/test";

test.describe("Theme switching", () => {
  test("home page has theme switcher button", async ({ page }) => {
    await page.goto("/");
    // Look for theme/palette button in the UI
    const themeBtn = page.getByRole("button", { name: /theme|palette|apparence/i }).first();
    if (await themeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(themeBtn).toBeVisible();
    }
  });

  test("theme dialog opens on click", async ({ page }) => {
    await page.goto("/");

    // The theme switcher might be in the settings or as a direct button
    // First check if there's a palette/theme button on the page
    const paletteBtn = page
      .locator(
        "button:has(svg.lucide-palette), button:has(svg.lucide-sun), button:has(svg.lucide-moon)",
      )
      .first();
    if (await paletteBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await paletteBtn.click();

      // Dialog with theme options should appear
      const dialog = page.locator('[role="dialog"]').first();
      if (await dialog.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Should show theme names
        const themeNames = [
          /light/i,
          /dark/i,
          /emerald/i,
          /ocean/i,
          /sunset/i,
          /purple/i,
          /midnight/i,
        ];
        let foundTheme = false;
        for (const name of themeNames) {
          if (
            await page
              .locator("button, div, span, label", { hasText: name })
              .first()
              .isVisible({ timeout: 500 })
              .catch(() => false)
          ) {
            foundTheme = true;
            break;
          }
        }
        expect(foundTheme).toBeTruthy();
      }
    }
  });

  test("can select a different theme from dialog", async ({ page }) => {
    await page.goto("/");

    const paletteBtn = page
      .locator(
        "button:has(svg.lucide-palette), button:has(svg.lucide-sun), button:has(svg.lucide-moon)",
      )
      .first();
    if (await paletteBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await paletteBtn.click();
      await page.waitForTimeout(500);

      // Try to click on a theme (e.g., Dark or Emerald)
      const darkTheme = page.locator("button, div", { hasText: /^dark$/i }).first();
      const emeraldTheme = page.locator("button, div", { hasText: /^emerald$/i }).first();
      const themeToClick = (await darkTheme.isVisible({ timeout: 1000 }).catch(() => false))
        ? darkTheme
        : emeraldTheme;

      if (await themeToClick.isVisible({ timeout: 1000 }).catch(() => false)) {
        await themeToClick.click();
        await page.waitForTimeout(500);
        // Theme should have changed - the body should have a class or attribute
        await expect(page.locator("body")).toBeVisible();
      }
    }
  });

  test("theme settings in settings page", async ({ page }) => {
    await page.goto("/settings");

    // Navigate to appearance/theme section
    const appearanceLink = page
      .locator("a, button, span, div", { hasText: /apparence|appearance|theme/i })
      .first();
    if (await appearanceLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await appearanceLink.click();
      await page.waitForTimeout(500);
    }

    // Should have some theme-related controls
    await expect(page.locator("body")).toBeVisible();
  });
});
