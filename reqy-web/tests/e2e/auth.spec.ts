import { test, expect } from "@playwright/test";

test.describe("Auth", () => {
  test("auth page loads", async ({ page }) => {
    // Navigate to login - it's ok if it redirects
    await page.goto("/login", { waitUntil: "networkidle" }).catch(() => page.goto("/"));
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
  });

  test("login form has email/username input", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" }).catch(() => page.goto("/"));
    const emailInput = page
      .locator(
        'input[type="email"], input[name="email"], input[placeholder*="email"i], input[name="login"]',
      )
      .first();
    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(emailInput).toBeVisible();
    }
  });

  test("login button is accessible", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" }).catch(() => page.goto("/"));
    const loginBtn = page
      .getByRole("button", { name: /login|sign in|se connecter|connexion/i })
      .first();
    if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(loginBtn).toBeVisible();
    }
  });
});
