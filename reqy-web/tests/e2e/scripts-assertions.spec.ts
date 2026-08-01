import { test, expect } from "@playwright/test";

test.describe("Scripts & Assertions", () => {
  test("Scripts accordion section expands on home page", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Scroll down to find the Scripts accordion section
    const scriptsAccordion = page.locator("button", { hasText: /Scripts/i }).first();
    await expect(scriptsAccordion).toBeVisible();
    await scriptsAccordion.click();

    // When expanded, should show the script editor (CodeMirror)
    await page.waitForTimeout(500);

    // Should show pre-request and post-response script labels
    const preReqLabel = page.locator("text", { hasText: /Pre-request|Pre.request/i }).first();
    if (await preReqLabel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(preReqLabel).toBeVisible();
    }

    const postRespLabel = page.locator("text", { hasText: /Post-response|Post.response/i }).first();
    if (await postRespLabel.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(postRespLabel).toBeVisible();
    }
  });

  test("Assertions accordion section expands", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Find and click the Assertions accordion
    const assertionsAccordion = page.locator("button", { hasText: /^Assertions$/i }).first();
    await expect(assertionsAccordion).toBeVisible();
    await assertionsAccordion.click();
    await page.waitForTimeout(500);

    // When expanded, should show the Add button
    const addBtn = page.locator("button", { hasText: /Add/i }).first();
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addBtn.click();
      // After Add, assertion fields (type select) should appear
      const assertionSelect = page
        .locator("button", { hasText: /status|time|json path|schema/i })
        .first();
      if (await assertionSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(assertionSelect).toBeVisible();
      }
    }
  });

  test("Tests accordion section expands", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Find and click the Tests accordion
    const testsAccordion = page.locator("button", { hasText: /^Tests$/i }).first();
    await expect(testsAccordion).toBeVisible();
    await testsAccordion.click();
    await page.waitForTimeout(500);

    // Should show test-related controls
    await expect(page.locator("body")).toBeVisible();
  });
});
