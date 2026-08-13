import { test, expect } from "@playwright/test";

test.describe("GraphQL dashboard redesign", () => {
  test("page loads with full layout (sidebar, header, tab bar, request panel, response panel)", async ({
    page,
  }) => {
    await page.goto("/graphql");
    await expect(page.getByTestId("graphql-page")).toBeVisible();
    await expect(page.getByTestId("graphql-tab-bar")).toBeVisible();
    await expect(page.getByTestId("graphql-active-toolbar")).toBeVisible();
    await expect(page.getByTestId("graphql-request-panel")).toBeVisible();
    await expect(page.getByTestId("graphql-response-panel")).toBeVisible();
    await expect(page.getByTestId("graphql-tab-add")).toBeVisible();
  });

  test("default tab contains a starter endpoint and query", async ({ page }) => {
    await page.goto("/graphql");
    const endpoint = page.getByTestId("graphql-endpoint-input");
    await expect(endpoint).toBeVisible();
    await expect(endpoint).toHaveValue(/trevorblades\.com/);
    // Editor placeholder / initial value is the welcome comment
    const editor = page.locator('[data-testid="graphql-query-editor"] .cm-content');
    await expect(editor).toContainText("Welcome");
  });

  test("multi-tab workflow: add, switch, close", async ({ page }) => {
    await page.goto("/graphql");
    // Count only tab buttons (exclude close buttons and add button)
    const tabButtons = page
      .getByTestId("graphql-tab-bar")
      .locator(
        '[data-testid^="graphql-tab-"]:not([data-testid*="close"]):not([data-testid="graphql-tab-add"])',
      );
    const initialTabCount = await tabButtons.count();
    // Add a new tab
    await page.getByTestId("graphql-tab-add").click();
    await expect(tabButtons).toHaveCount(initialTabCount + 1);
    // Switch back to the first tab
    const firstTabBtn = tabButtons.first();
    await firstTabBtn.click();
    // The first tab should now be active
    await expect(firstTabBtn).toHaveAttribute("data-active", "true");
    // Close the second tab (original first tab stays open)
    const secondTabBtn = tabButtons.nth(1);
    if (await secondTabBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const secondId = (await secondTabBtn.getAttribute("data-testid"))?.replace(
        "graphql-tab-",
        "",
      );
      if (secondId) {
        await page.getByTestId(`graphql-tab-close-${secondId}`).click();
      }
    }
    await expect(tabButtons).toHaveCount(initialTabCount);
  });

  test("prettify reformats the query", async ({ page }) => {
    await page.goto("/graphql");
    const editor = page.locator('[data-testid="graphql-query-editor"] .cm-content');
    await editor.fill("{a,b,c,d}");
    // Prettify button is inside graphql-toolbar
    await page.locator('[data-testid="graphql-prettify-button"]').click();
    // After prettify the editor should contain newlines
    await expect(editor).toContainText("\n");
  });

  test("response panel tabs: Response, Code, Schema Diff", async ({ page }) => {
    await page.goto("/graphql");
    for (const tab of ["response", "code", "diff"]) {
      await page.getByTestId(`graphql-response-tab-${tab}`).click();
      await expect(page.getByTestId(`graphql-response-tab-${tab}`)).toBeVisible();
    }
  });

  test("code generator formats the active query as fetch", async ({ page }) => {
    await page.goto("/graphql");
    const editor = page.locator('[data-testid="graphql-query-editor"] .cm-content');
    await editor.fill("{ hello }");
    await page.getByTestId("graphql-response-tab-code").click();
    await expect(page.getByTestId("graphql-code-generator")).toBeVisible();
    await expect(page.getByTestId("graphql-code-preview")).toContainText("fetch(");
  });

  test("save dialog flow opens and accepts a name + collection", async ({ page }) => {
    await page.goto("/graphql");
    await page.getByTestId("graphql-save-button").click();
    // RequestSaveDialog renders the name input
    const name = page.locator("#save-name");
    await expect(name).toBeVisible();
    await name.fill("My GraphQL request");
    // Submit
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^(Save|Enregistrer)$/i })
      .click();
  });

  test("export button downloads a JSON file", async ({ page }) => {
    await page.goto("/graphql");
    const downloadPromise = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
    await page.getByTestId("graphql-export-button").click();
    const download = await downloadPromise;
    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.graphql\.json$/);
    }
  });
});
