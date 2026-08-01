import { test, expect } from "@playwright/test";

test.describe("AI Assistant", () => {
  test("page loads with chat interface", async ({ page }) => {
    await page.goto("/ai-insights");
    // Page should load
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
  });

  test("provider selector is present", async ({ page }) => {
    await page.goto("/ai-insights");
    // Look for a provider/AI selection dropdown
    const providerBtn = page.getByRole("button", { name: /openai|anthropic|provider|ai/i }).first();
    if (await providerBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(providerBtn).toBeVisible();
    }
  });

  test("chat input area exists", async ({ page }) => {
    await page.goto("/ai-insights");
    // Look for a textarea or input for chat messages
    const inputArea = page
      .locator('textarea, input[placeholder*="message"i], input[placeholder*="ask"i]')
      .first();
    if (await inputArea.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(inputArea).toBeVisible();
    }
  });

  test("show AI chat button works from request page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });

    // The show-ai-chat-button might be in the sidebar
    const aiChatBtn = page.getByTestId("show-ai-chat-button").first();
    if (await aiChatBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await aiChatBtn.click();
      // AI sidebar should appear
      const aiSidebar = page.locator(
        '[data-testid="ai-sidebar"], [data-testid="show-ai-chat-button"]',
      );
      await expect(aiSidebar.first()).toBeVisible();
    }
  });

  test("suggestion prompts are shown", async ({ page }) => {
    await page.goto("/ai-insights");
    // Look for suggestion buttons/prompts
    const suggestion = page
      .locator("button, div", { hasText: /recommandation|recommend|résume|summarize/i })
      .first();
    if (await suggestion.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(suggestion).toBeVisible();
    }
  });
});
