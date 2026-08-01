import type { Page, Locator } from "@playwright/test"

export const urlInput = (page: Page): Locator =>
  page.locator('[data-testid="url-input"]').first()

export const sendButton = (page: Page): Locator =>
  page.locator('[data-testid="send-button"]').first()

export const responseStatus = (page: Page): Locator =>
  page.locator('[data-testid="response-status"]').first()

export const responseBody = (page: Page): Locator =>
  page.locator('[data-testid="response-body"]').first()

export const methodSelector = (page: Page): Locator =>
  page.locator('[data-testid="method-selector"]').first()

export const requestTabs = (page: Page): Locator =>
  page.locator('[data-testid="request-tabs"]').first()

export const newCollectionButton = (page: Page): Locator =>
  page.getByRole("button", { name: /new collection|create collection/i }).first()

export const collectionNameInput = (page: Page): Locator =>
  page.locator('[data-testid="collection-name-input"]').first()

export const collectionList = (page: Page): Locator =>
  page.locator('[data-testid="collection-list"]').first()

export const createWorkspaceButton = (page: Page): Locator =>
  page.locator('[data-testid="create-workspace-button"]').first()

export const joinWorkspaceButton = (page: Page): Locator =>
  page.locator('[data-testid="join-workspace-button"]').first()

export const inviteWorkspaceButton = (page: Page): Locator =>
  page.locator('[data-testid="invite-workspace-button"]').first()

export const activeWorkspaceDisplay = (page: Page): Locator =>
  page.locator('[data-testid="active-workspace"]').first()

export const runButton = (page: Page): Locator =>
  page.locator('[data-testid="run-button"]').first()

export const statusBadge = (page: Page): Locator =>
  page.locator('[data-testid="response-status"]').first()
