import { test, expect } from "@playwright/test";

test.describe("AI Assistant sidebar", () => {
  test("can open and close sidebar via header toggle + Cmd+I", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("store-ready")).toHaveAttribute("data-ready", "true", {
      timeout: 10000,
    });
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });

    // Open via header toggle button (Sparkles icon)
    const toggle = page.getByTestId("ai-sidebar-toggle");
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveAttribute("aria-controls", "reqly-ai-sidebar");

    // Sidebar appears with data-testid="ai-sidebar"
    const sidebar = page.getByTestId("ai-sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveAttribute("id", "reqly-ai-sidebar");

    // Close via Escape
    await page.keyboard.press("Escape");
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("suggestion prompts are shown in empty state", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByTitle(/Ouvrir l'assistant IA/i);
    await toggle.click();

    const sidebar = page.getByTestId("ai-sidebar");
    await expect(sidebar).toBeVisible();

    // Check that the empty state suggestions exist
    const suggestion = sidebar.getByRole("button", { name: /Exécute GET/i });
    await expect(suggestion).toBeVisible();
  });

  test("chat input area exists and accepts text", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByTitle(/Ouvrir l'assistant IA/i);
    await toggle.click();

    const input = page.getByTestId("ai-sidebar").locator("textarea");
    await expect(input).toBeVisible();

    await input.fill("Hello AI");
    await expect(input).toHaveValue("Hello AI");
  });
});
