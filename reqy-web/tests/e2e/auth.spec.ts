import { test, expect } from "@playwright/test";

test.describe("Auth", () => {
  test("auth page loads", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
  });

  test("login form has email/username input", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    const emailInput = page
      .locator(
        'input[type="email"], input[name="email"], input[placeholder*="email"i], input[name="login"]',
      )
      .first();
    await expect(emailInput).toBeVisible();
  });

  test("login button is accessible", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    const loginBtn = page
      .getByRole("button", { name: /login|sign in|se connecter|connexion/i })
      .first();
    await expect(loginBtn).toBeVisible();
  });
});
