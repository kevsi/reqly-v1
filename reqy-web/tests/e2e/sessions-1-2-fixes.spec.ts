import { test, expect } from "@playwright/test";

test.describe("Session 1 & 2 — REST editor + GraphQL fixes", () => {
  test("method selector includes HEAD and OPTIONS", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByTestId("method-selector").first();
    await expect(trigger).toBeVisible();
    await trigger.click();
    // Check that HEAD and OPTIONS appear in the dropdown (GRAPHQL is available only on /graphql page)
    const dropdown = page.locator('[role="listbox"]');
    await expect(dropdown.locator('text="HEAD"')).toBeVisible({ timeout: 3000 });
    await expect(dropdown.locator('text="OPTIONS"')).toBeVisible();
  });

  test("binary body type is selectable", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("store-ready")).toHaveAttribute("data-ready", "true", {
      timeout: 10000,
    });
    // Open the Body accordion
    const bodyAccordion = page.getByText(/^(Body|Corps)/i).first();
    await bodyAccordion.click();
    const bodyTypeSelect = page.getByTestId("body-type-select");
    await expect(bodyTypeSelect).toBeVisible();
    // Open the body type dropdown
    await bodyTypeSelect.click();
    const dropdown = page.locator('[role="listbox"]');
    await expect(dropdown.getByText(/^(Binary|Binaire)$/i)).toBeVisible({ timeout: 3000 });
  });

  test("GraphQL page shows empty response state", async ({ page }) => {
    await page.goto("/graphql");
    const emptyState = page.getByTestId("graphql-response-empty");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText(/No response yet|Aucune réponse/i);
  });

  test("GraphQL tab bar shows duplicate button", async ({ page }) => {
    await page.goto("/graphql");
    const duplicateBtn = page.getByTestId("graphql-tab-duplicate");
    await expect(duplicateBtn).toBeVisible();
    await expect(duplicateBtn).toContainText(/Duplicate|Dupliquer/i);
  });

  test("GraphQL Schema toggle opens documentation panel", async ({ page }) => {
    await page.goto("/graphql");
    const toggleBtn = page.getByTestId("graphql-toggle-schema");
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toContainText(/Show Schema|Afficher Schéma/i);
    await toggleBtn.click();
    // After click the button should say "Hide Schema"
    await expect(toggleBtn).toContainText(/Hide Schema|Masquer Schéma/i);
  });
});
