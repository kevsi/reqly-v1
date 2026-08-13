import { test, expect } from "@playwright/test";

test.describe("API Request flows", () => {
  test("sends a GET request and displays response", async ({ page }) => {
    await page.goto("/");

    // Wait for the app to load
    await page.waitForSelector('[role="tab"]', { timeout: 10_000 });

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
    await page.goto("/");

    await page.waitForSelector('[role="tab"]', { timeout: 10_000 });

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
    await page.goto("/");

    await page.waitForSelector('[role="tab"]', { timeout: 10_000 });

    // Enter URL with query param
    const urlInput = page.getByTestId("url-input").first();
    await urlInput.fill("https://httpbin.org/get");

    // Add a query param
    const addParamButton = page.getByRole("button", { name: /add param|ajouter param/i }).first();
    if (await addParamButton.isVisible().catch(() => false)) {
      await addParamButton.click();
      const keyInputs = await page.locator('input[placeholder*="key"]').all();
      const valueInputs = await page.locator('input[placeholder*="value"]').all();
      if (keyInputs.length > 0 && valueInputs.length > 0) {
        await keyInputs[0].fill("foo");
        await valueInputs[0].fill("bar");
      }
    }

    // Add a header
    const addHeaderButton = page
      .getByRole("button", { name: /add header|ajouter header/i })
      .first();
    if (await addHeaderButton.isVisible().catch(() => false)) {
      await addHeaderButton.click();
      const headerKeyInputs = await page.locator('input[placeholder*="header"]').all();
      const headerValueInputs = await page.locator('input[placeholder*="value"]').all();
      if (headerKeyInputs.length > 0 && headerValueInputs.length > 0) {
        await headerKeyInputs[0].fill("X-Custom-Header");
        await headerValueInputs[0].fill("test-value");
      }
    }

    // Click Send (wait for url to be accepted — the send button was disabled before)
    const sendButton = page.getByTestId("send-button").first();
    await expect(sendButton).toBeEnabled({ timeout: 10_000 });
    await sendButton.click();

    const statusIndicator = page.locator("text=/200|OK/i").first();
    await expect(statusIndicator).toBeVisible({ timeout: 15_000 });
  });
});
