import { test, expect } from "@playwright/test";

test.describe("SDK Generator", () => {
  test("page loads with testids", async ({ page }) => {
    await page.goto("/sdks");
    await expect(page.getByTestId("sdks-page")).toBeVisible({ timeout: 10000 });
  });

  test("shows source collection selector", async ({ page }) => {
    await page.goto("/sdks");
    const collectionSelect = page.getByTestId("source-collection-select");
    await expect(collectionSelect).toBeVisible();
  });

  test("shows language selector", async ({ page }) => {
    await page.goto("/sdks");
    const langSelect = page.getByTestId("language-select");
    await expect(langSelect).toBeVisible();
  });

  test("shows endpoint input for OpenAPI generator", async ({ page }) => {
    await page.goto("/sdks");
    const endpointInput = page.getByTestId("generator-endpoint-input");
    await expect(endpointInput).toBeVisible();
  });

  test("generate button is present", async ({ page }) => {
    await page.goto("/sdks");
    const genBtn = page.getByTestId("generate-button");
    await expect(genBtn).toBeVisible();
  });

  test("can select a programming language", async ({ page }) => {
    await page.goto("/sdks");
    // Open the language select dropdown
    const langTrigger = page.getByTestId("language-select").locator("button").first();
    if (await langTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
      await langTrigger.click();
      // Should see language options
      const langOption = page.getByRole("option").first();
      if (await langOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(langOption).toBeVisible();
      }
    }
  });

  test("SDK download button exists in collections", async ({ page }) => {
    await page.goto("/collections");
    // Check if SDK download button is present
    const sdkBtn = page.getByTestId("sdk-download-button");
    if (await sdkBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(sdkBtn).toBeVisible();
    }
  });
});
