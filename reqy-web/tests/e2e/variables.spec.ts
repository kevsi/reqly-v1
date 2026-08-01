import { test, expect } from '@playwright/test'

test.describe('Environment Variables flows', () => {
  test('creates a variable and uses it in a request URL', async ({ page }) => {
    await page.goto('/')

    await page.waitForSelector('[role="tab"]', { timeout: 10_000 })

    // Open environment panel (via sidebar or settings)
    const envButton = page.getByRole('button', { name: /environments|variables/i }).first()
    if (await envButton.isVisible().catch(() => false)) {
      await envButton.click()
    } else {
      // Try sidebar
      await page.getByRole('button', { name: /settings/i }).first().click()
      await page.getByText('Environments', { exact: false }).click()
    }

    // Add a new variable
    const addVarButton = page.getByRole('button', { name: /add variable|ajouter variable/i }).first()
    await addVarButton.click()

    const keyInput = page.locator('input[placeholder*="key"], input[placeholder*="name"]').first()
    await keyInput.fill('baseUrl')

    const valueInput = page.locator('input[placeholder*="value"]').first()
    await valueInput.fill('https://httpbin.org')

    // Save / close panel if needed
    await page.keyboard.press('Escape')

    // Go back to editor and use variable in URL
    await page.goto('/')
    await page.waitForSelector('[role="tab"]', { timeout: 10_000 })

    const urlInput = page.locator('input[placeholder*="URL"], input[name="url"]').first()
    await urlInput.fill('{{baseUrl}}/get')

    // Send request
    const sendButton = page.getByRole('button', { name: /send|envoyer/i }).first()
    await sendButton.click()

    // Should succeed (interpolated URL)
    const statusIndicator = page.locator('text=/200|OK/i').first()
    await expect(statusIndicator).toBeVisible({ timeout: 15_000 })
  })
})
