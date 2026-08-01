import { test, expect } from "@playwright/test";

test.describe("Capture (HTTP proxy)", () => {
  test("page loads with main elements", async ({ page }) => {
    await page.goto("/capture");
    // The capture page should show a title
    const title = page.locator("h1").first();
    await expect(title).toBeVisible({ timeout: 10000 });
    // Should show the port input
    const portInput = page.locator("#capture-port").first();
    await expect(portInput).toBeVisible();
  });

  test("shows capture sessions header", async ({ page }) => {
    await page.goto("/capture");
    // Should show a header or title related to proxy/sessions
    const title = page.locator("h1, h2, h3", { hasText: /capture|proxy|session/i }).first();
    await expect(title).toBeVisible({ timeout: 10000 });
  });

  test("has action buttons (start/stop proxy)", async ({ page }) => {
    await page.goto("/capture");
    // Look for start proxy button ("Démarrer la capture") or the refresh button
    const demarrerBtn = page.getByRole("button", { name: /d.marrer|start|begin|play/i }).first();
    const rafraichirBtn = page.getByRole("button", { name: /rafraichir|refresh/i }).first();
    const effacerBtn = page.getByRole("button", { name: /effacer|clear|trash|vider/i }).first();

    const hasActionButtons =
      (await demarrerBtn.isVisible({ timeout: 3000 }).catch(() => false)) ||
      (await rafraichirBtn.isVisible({ timeout: 1000 }).catch(() => false)) ||
      (await effacerBtn.isVisible({ timeout: 1000 }).catch(() => false));
    expect(hasActionButtons).toBeTruthy();
  });
});
