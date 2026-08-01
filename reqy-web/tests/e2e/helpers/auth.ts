import type { Page } from "@playwright/test"

export async function loginAsTestUser(page: Page): Promise<void> {
  await page.goto("/")
}

export async function logout(page: Page): Promise<void> {
  await page.context().clearCookies()
  await page.goto("/")
}
