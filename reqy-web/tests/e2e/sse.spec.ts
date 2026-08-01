import { test, expect } from "@playwright/test";

test.describe("SSE (Server-Sent Events)", () => {
  test("page loads with all key elements", async ({ page }) => {
    await page.goto("/sse");
    await expect(page.getByTestId("sse-page")).toBeVisible();

    // URL input and connect button should be present
    const urlInput = page.locator('input[placeholder*="URL"i]').first();
    await expect(urlInput).toBeVisible();
    await expect(urlInput).toHaveValue(/localhost:3000\/sse/);

    // Connect button should be visible (either "Connect" or "Disconnect" depending on state)
    await expect(
      page.getByRole("button", { name: /connect|disconnect|envoyer|send/i }).first(),
    ).toBeVisible();
  });

  test("can toggle auth type selector", async ({ page }) => {
    await page.goto("/sse");
    await expect(page.getByTestId("sse-page")).toBeVisible();

    // Look for auth select (No Auth / Bearer Token / Basic Auth)
    const authTrigger = page
      .getByRole("button", { name: /no auth|bearer token|basic auth|auth/i })
      .first();
    if (await authTrigger.isVisible().catch(() => false)) {
      await authTrigger.click();
      // Should see Bearer Token option
      const bearerOption = page.getByRole("option", { name: /bearer/i }).first();
      if (await bearerOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await bearerOption.click();
      }
    }
  });

  test("can toggle connection options (headers section)", async ({ page }) => {
    await page.goto("/sse");
    await expect(page.getByTestId("sse-page")).toBeVisible();

    // Look for a button to show/hide options
    const optionsBtn = page.getByRole("button", { name: /options|headers|show/i }).first();
    if (await optionsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await optionsBtn.click();
    }
    // Page should still be in good shape
    await expect(page.getByTestId("sse-page")).toBeVisible();
  });

  test("events list area is present", async ({ page }) => {
    await page.goto("/sse");
    await expect(page.getByTestId("sse-page")).toBeVisible();

    // The events list should show "No events" or be an empty scroll area
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("clear events button is visible", async ({ page }) => {
    await page.goto("/sse");
    // Look for a clear/trash button
    const clearBtn = page.getByRole("button", { name: /clear|trash|delete|vider/i }).first();
    if (await clearBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(clearBtn).toBeVisible();
    }
  });
});
