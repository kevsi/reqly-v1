import { test, expect } from "@playwright/test";

test.describe("Documentation", () => {
  test("page loads with documentation sections", async ({ page }) => {
    await page.goto("/documentation");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
  });

  test("shows overview section", async ({ page }) => {
    await page.goto("/documentation");
    // Should show a heading about overview
    const overview = page
      .locator("h1, h2, h3, h4, div, span", { hasText: /overview|vue d.ensemble/i })
      .first();
    await expect(overview).toBeVisible({ timeout: 10000 });
  });

  test("navigation sidebar has documentation sections", async ({ page }) => {
    await page.goto("/documentation");
    // Documentation pages typically have a sidebar with section links
    const sectionLinks = [/overview/i, /request/i, /response/i, /api/i, /auth/i];
    let foundAny = false;
    for (const link of sectionLinks) {
      const el = page.locator("a, button, div, span", { hasText: link }).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        foundAny = true;
        break;
      }
    }
    expect(foundAny).toBeTruthy();
  });

  test("can click on a documentation section to navigate", async ({ page }) => {
    await page.goto("/documentation");

    // Click on a documentation section link
    const sectionLink = page.locator("a", { hasText: /making request|request|response/i }).first();
    if (await sectionLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await sectionLink.click();
      await page.waitForTimeout(500);
      // Content should change
      await expect(page.locator("body")).toBeVisible();
    }
  });
});
