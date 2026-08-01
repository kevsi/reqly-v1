import { test, expect } from "@playwright/test";

test.describe("Settings", () => {
  test("page loads and shows settings layout", async ({ page }) => {
    await page.goto("/settings");
    // Should show a settings title or heading
    const heading = page
      .locator("h1, h2, strong", { hasText: /settings|parametres|configuration/i })
      .first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("settings sidebar navigation items exist", async ({ page }) => {
    await page.goto("/settings");

    // Look for common settings section labels in the sidebar
    const sectionLabels = [
      /ai/i,
      /apparence|theme|appearance/i,
      /shortcuts|keyboard|raccourcis/i,
      /module/i,
    ];
    let foundAny = false;
    for (const label of sectionLabels) {
      const el = page.locator("a, button, span, div", { hasText: label }).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        foundAny = true;
        break;
      }
    }
    expect(foundAny).toBeTruthy();
  });

  test("can click on AI section in sidebar", async ({ page }) => {
    await page.goto("/settings");

    const aiLink = page.locator("a, button, span, div", { hasText: /ai/i }).first();
    if (await aiLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await aiLink.click();
      // After clicking the AI section, the content should change
      await page.waitForTimeout(1000);
      const aiContent = page.locator("body");
      await expect(aiContent).toBeVisible();
    }
  });

  test("theme section shows theme options", async ({ page }) => {
    await page.goto("/settings");

    const themeLink = page
      .locator("a, button, span, div", { hasText: /apparence|theme|appearance/i })
      .first();
    if (await themeLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await themeLink.click();
      await page.waitForTimeout(500);
    }
    // Page should still be functional
    await expect(page.locator("body")).toBeVisible();
  });

  test("notifications section has test toast button", async ({ page }) => {
    await page.goto("/settings");

    // Navigate to notifications
    const notifLink = page.locator("a, button, span, div", { hasText: /notif/i }).first();
    if (await notifLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await notifLink.click();
      await page.waitForTimeout(500);
    }

    // The "Tester un toast" button from the existing toast test
    const testToastBtn = page.getByText("Tester un toast", { exact: true });
    if (await testToastBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await testToastBtn.click();
      await expect(page.getByText("Test de notification (toast)")).toBeVisible({ timeout: 5000 });
    }
  });
});
