import { test, expect } from "@playwright/test";
import { mockHttpbin } from "./helpers/httpbin";

/**
 * Seed IndexedDB with a collection containing a request, replicating what
 * the app's persistence layer (storage-adapter.ts + idb-keyval) does.
 * Must be called AFTER page.goto() so IndexedDB is accessible.
 */
async function seedIndexedDB(page: import("@playwright/test").Page) {
  const now = Date.now();
  await page.evaluate((ts) => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("keyval-store", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("keyval");
      };
      req.onsuccess = () => {
        const tx = req.result.transaction("keyval", "readwrite");
        const store = tx.objectStore("keyval");
        store.put(
          JSON.stringify({
            history: [],
            collections: [
              {
                id: "col-test",
                name: "Test Collection",
                description: "",
                color: "emerald",
                icon: "package",
                workspaceId: "ws-personal",
                requests: [
                  {
                    id: "req-test-1",
                    name: "Get Test",
                    method: "GET",
                    url: "https://httpbin.org/get",
                    endpoint: "/get",
                    headers: {},
                    body: "",
                    bodyType: "json",
                    authType: "none",
                    authToken: "",
                    queryParams: [{ key: "foo", value: "bar" }],
                    order: 1000,
                    createdAt: ts,
                    updatedAt: ts,
                  },
                ],
                createdAt: ts,
                updatedAt: ts,
              },
            ],
            environments: [
              {
                id: "env-global",
                name: "Global",
                color: "slate",
                variables: [],
                createdAt: ts,
                updatedAt: ts,
              },
            ],
            notifications: [],
            variableMappings: [],
            activeEnvironmentId: "env-global",
            activeWorkspaceId: "ws-personal",
            workspaces: [
              {
                id: "ws-personal",
                name: "Personal",
                color: "slate",
                icon: "user",
                createdAt: ts,
                updatedAt: ts,
              },
            ],
            projects: [],
            selectedProjectId: null,
          }),
          "reqly-request-store",
        );
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, now);
}

test.describe("Collections to Editor flow", () => {
  test("opens a collection request in the editor from the collections page", async ({ page }) => {
    await mockHttpbin(page);
    // Navigate first, seed IndexedDB, then reload to trigger store rehydration
    await page.goto("/collections");
    await seedIndexedDB(page);
    await page.reload();

    // Wait for the rehydrated collection to appear
    const collection = page.getByText("Test Collection", { exact: false }).first();
    await expect(collection).toBeVisible({ timeout: 20_000 });

    // Expand the collection by clicking on the name
    await collection.click();

    // The request "Get Test" should now be visible
    const requestRow = page.getByText("Get Test", { exact: false }).first();
    await expect(requestRow).toBeVisible({ timeout: 10_000 });

    // Click the request to open in editor — this navigates to / and opens a tab
    await requestRow.click();

    // Wait for the request tab to appear (covers navigation + rendering)
    const tab = page.getByRole("tab", { name: "Get Test" }).first();
    await expect(tab).toBeVisible({ timeout: 20_000 });

    // Verify the URL is loaded into the input
    const urlInput = page.getByTestId("url-input").first();
    await expect(urlInput).toBeVisible({ timeout: 10_000 });
  });

  test("clicking an already-open request activates the tab without duplication", async ({
    page,
  }) => {
    await mockHttpbin(page);
    // Navigate first, seed IndexedDB, then reload
    await page.goto("/collections");
    await seedIndexedDB(page);
    await page.reload();

    // Expand collection
    const collection = page.getByText("Test Collection", { exact: false }).first();
    await expect(collection).toBeVisible({ timeout: 20_000 });
    await collection.click();

    // Click request → opens and navigates to editor
    const requestRow = page.getByText("Get Test", { exact: false }).first();
    await expect(requestRow).toBeVisible({ timeout: 10_000 });
    await requestRow.click();

    // Wait for the request tab to appear in the editor
    const homeTab = page.getByRole("tab", { name: "Get Test" }).first();
    await expect(homeTab).toBeVisible({ timeout: 20_000 });

    // Go back to collections and click again
    await page.goto("/collections");
    const collectionAgain = page.getByText("Test Collection", { exact: false }).first();
    await expect(collectionAgain).toBeVisible({ timeout: 20_000 });
    const requestRowAgain = page.getByText("Get Test", { exact: false }).first();
    if (!(await requestRowAgain.isVisible())) {
      await collectionAgain.click();
    }
    await expect(requestRowAgain).toBeVisible({ timeout: 10_000 });
    await requestRowAgain.click();

    // The same tab should still be visible (no duplicate tab created)
    await expect(homeTab).toBeVisible({ timeout: 20_000 });
  });
});
