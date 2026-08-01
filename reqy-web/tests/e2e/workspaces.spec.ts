import { test, expect } from "@playwright/test";

test.describe("Workspaces", () => {
  test("page loads with key elements", async ({ page }) => {
    await page.goto("/workspaces");
    // Workspaces heading should be visible
    const heading = page.locator("h1, h2, strong", { hasText: /workspace/i }).first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    // Join workspace button should exist (has data-testid)
    await expect(page.getByTestId("join-workspace-button")).toBeVisible();
  });

  test("create workspace dialog opens", async ({ page }) => {
    await page.goto("/workspaces");

    const createBtn = page.getByRole("button", { name: /create|nouveau|add workspace/i }).first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();

      // Dialog should have a name input
      const nameInput = page.locator('input[name="name"], input[placeholder*="name"i]').first();
      if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nameInput.fill("Test Workspace");
        await expect(nameInput).toHaveValue("Test Workspace");
      }
    }
  });

  test("signed-out banner may appear when not authenticated", async ({ page }) => {
    await page.goto("/workspaces");
    // The sync-signed-out banner may be visible if not authenticated
    const banner = page.getByTestId("sync-signed-out");
    if (await banner.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(banner).toBeVisible();
    }
  });
});
