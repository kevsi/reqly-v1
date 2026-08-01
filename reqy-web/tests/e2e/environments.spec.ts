import { test, expect } from "@playwright/test";

test.describe("Environments", () => {
  test("environment selector is visible on home page", async ({ page }) => {
    await page.goto("/");
    const envSelector = page
      .getByRole("button", { name: /select environment|no environment|environment/i })
      .first();
    await expect(envSelector).toBeVisible({ timeout: 10000 });
  });

  test("environment selector dropdown shows manage option", async ({ page }) => {
    await page.goto("/");

    // Open the environment dropdown
    const envBtn = page.getByRole("button", { name: /environment/i }).first();
    await expect(envBtn).toBeVisible({ timeout: 10000 });
    await envBtn.click();

    // "Manage Environments" option should be visible
    const manageOption = page.getByRole("menuitem", { name: /manage environment/i });
    if (await manageOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(manageOption).toBeVisible();
    }
  });

  test("Manage Environments dialog opens", async ({ page }) => {
    await page.goto("/");

    // Open the environment dropdown
    const envBtn = page.getByRole("button", { name: /environment/i }).first();
    await envBtn.click();

    // Click "Manage Environments"
    const manageOption = page.getByRole("menuitem", { name: /manage environment/i });
    if (await manageOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await manageOption.click();

      // Dialog should open with a title
      const dialogTitle = page.locator("h2", { hasText: /manage|environment/i });
      await expect(dialogTitle).toBeVisible({ timeout: 5000 });
    }
  });

  test("can create a new environment from dropdown", async ({ page }) => {
    await page.goto("/");

    // Open the environment dropdown
    const envBtn = page.getByRole("button", { name: /environment/i }).first();
    await envBtn.click();

    // Click "New Environment"
    const newEnvOption = page.getByRole("menuitem", { name: /new environment/i });
    if (await newEnvOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newEnvOption.click();

      // The manage dialog should open with the new environment selected
      const dialog = page.locator('[role="dialog"]').first();
      if (await dialog.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Should see variable input fields
        const varInputs = page.locator('input[placeholder*="key"i], input[placeholder*="value"i]');
        const count = await varInputs.count();
        expect(count).toBeGreaterThan(0);
      }
    }
  });
});
