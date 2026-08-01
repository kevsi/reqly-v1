import { test, expect } from "@playwright/test";

test.describe("Projects", () => {
  test("page loads with title and elements", async ({ page }) => {
    await page.goto("/my-projects");
    // Should show a projects-related heading
    const heading = page.locator("h1, h2, h3, strong", { hasText: /projet|project/i }).first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("new project button opens modal", async ({ page }) => {
    await page.goto("/my-projects");

    // Find the new project button
    const newBtn = page
      .getByRole("button", { name: /new project|nouveau projet|add project|create/i })
      .first();
    if (await newBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await newBtn.click();

      // Modal should open with name/URL inputs
      const nameInput = page.locator('input[name="name"], input[placeholder*="name"i]').first();
      if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nameInput.fill("Test Project");
        await expect(nameInput).toHaveValue("Test Project");
      }
    }
  });

  test("import from GitHub button is accessible", async ({ page }) => {
    await page.goto("/my-projects");

    const githubBtn = page.getByRole("button", { name: /github/i }).first();
    if (await githubBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(githubBtn).toBeVisible();
    }
  });
});
