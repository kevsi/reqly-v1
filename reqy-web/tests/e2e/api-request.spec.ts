import { test, expect } from "@playwright/test";
import { mockHttpbin } from "./helpers/httpbin";

test.describe("API Request flows", () => {
  test("sends a GET request and displays response", async ({ page }) => {
    await mockHttpbin(page);
    await page.goto("/");

    // Wait for the app to load
    await page.waitForSelector('[role="tab"]', { timeout: 10_000 });
    await expect(page.getByTestId("store-ready")).toHaveAttribute("data-ready", "true", {
      timeout: 10_000,
    });

    // Enter URL
    const urlInput = page.getByTestId("url-input").first();
    await urlInput.fill("https://httpbin.org/get");

    // Click Send
    const sendButton = page.getByTestId("send-button").first();
    await sendButton.click();

    // Wait for response panel to show status
    const statusIndicator = page.locator("text=/200|OK/i").first();
    await expect(statusIndicator).toBeVisible({ timeout: 15_000 });

    // Response body should be visible
    const responseBody = page.getByTestId("response-body").first();
    await expect(responseBody).toBeVisible({ timeout: 10_000 });
  });

  test("sends a POST request with JSON body", async ({ page }) => {
    await mockHttpbin(page);
    await page.goto("/");

    await page.waitForSelector('[role="tab"]', { timeout: 10_000 });
    await expect(page.getByTestId("store-ready")).toHaveAttribute("data-ready", "true", {
      timeout: 10_000,
    });

    // Change method to POST
    const methodSelect = page.getByTestId("method-selector").first();
    await methodSelect.click();
    // Wait for the select content to appear, then click the POST item
    const postItem = page
      .locator('[role="option"], [data-radix-select-item]', { hasText: "POST" })
      .first();
    await expect(postItem).toBeVisible({ timeout: 5000 });
    await postItem.click();

    // Enter URL
    const urlInput = page.getByTestId("url-input").first();
    await urlInput.fill("https://httpbin.org/post");

    // Expand the Body accordion section and switch to JSON
    const bodyTrigger = page.locator("button", { hasText: /^(Body|Corps)/i }).first();
    await bodyTrigger.click();
    await page.waitForTimeout(300);

    // Enter JSON body
    const bodyEditor = page.getByTestId("request-body-textarea").first();
    await expect(bodyEditor).toBeVisible({ timeout: 5000 });
    await bodyEditor.fill(JSON.stringify({ test: true }));

    // Click Send
    const sendButton = page.getByTestId("send-button").first();
    await sendButton.click();

    // Wait for response
    const statusIndicator = page.locator("text=/200|OK/i").first();
    await expect(statusIndicator).toBeVisible({ timeout: 15_000 });
  });

  test("adds headers and query params", async ({ page }) => {
    await mockHttpbin(page);
    await page.goto("/");

    await page.waitForSelector('[role="tab"]', { timeout: 10_000 });
    await expect(page.getByTestId("store-ready")).toHaveAttribute("data-ready", "true", {
      timeout: 10_000,
    });

    // Enter URL with query param
    const urlInput = page.getByTestId("url-input").first();
    await urlInput.fill("https://httpbin.org/get");

    // Add a query param (expand the Query Params accordion first)
    const requestPanel = page.getByTestId("request-tabs");
    await requestPanel
      .getByRole("button", { name: /query params|paramètres de requête/i })
      .first()
      .click();
    const addParamButton = requestPanel
      .getByRole("button", { name: /add param|ajouter param/i })
      .first();
    await addParamButton.click();
    const keyInput = requestPanel.locator('input[placeholder*="key" i]').first();
    const valueInput = requestPanel.locator('input[placeholder*="value" i]').first();
    await expect(keyInput).toBeVisible();
    await keyInput.fill("foo");
    await valueInput.fill("bar");

    // Add a header (expand the Headers accordion first)
    await requestPanel
      .getByRole("button", { name: /^headers$|^en-têtes$/i })
      .first()
      .click();
    const addHeaderButton = requestPanel
      .getByRole("button", { name: /add header|ajouter header/i })
      .first();
    await addHeaderButton.click();
    const headerKeyInput = requestPanel.locator('input[placeholder*="key" i]').nth(1);
    const headerValueInput = requestPanel.locator('input[placeholder*="value" i]').nth(1);
    await expect(headerKeyInput).toBeVisible();
    await headerKeyInput.fill("X-Custom-Header");
    await headerValueInput.fill("test-value");

    // Click Send (wait for url to be accepted — the send button was disabled before)
    const sendButton = page.getByTestId("send-button").first();
    await expect(sendButton).toBeEnabled({ timeout: 10_000 });
    await sendButton.click();

    const statusIndicator = page.locator("text=/200|OK/i").first();
    await expect(statusIndicator).toBeVisible({ timeout: 15_000 });
  });
});
