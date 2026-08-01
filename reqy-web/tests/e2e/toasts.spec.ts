import { test, expect } from '@playwright/test'

test.describe('Toast Notifications', () => {
  test('Settings - Tester un toast button should show a toast', async ({ page }) => {
    // Navigate to settings
    await page.goto('/settings')
    
    // Click on the Notifications menu item
    await page.getByText('Notifications', { exact: true }).click()
    
    // Find and click the "Tester un toast" button
    const testToastButton = page.getByText('Tester un toast', { exact: true })
    await testToastButton.click()
    
    // Check if the toast is visible
    const toast = page.locator('.group.toast') // shadcn/ui toast usually has these classes, or we can look by text
    await expect(page.getByText('Test de notification (toast)')).toBeVisible()
  })

  // test('Collections - Creating a collection should show a toast', async ({ page }) => {
  //  ...
  // })
})
