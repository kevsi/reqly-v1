import { test, expect, type Page } from "@playwright/test";

/**
 * Seed IndexedDB with a collection containing requests and optionally a folder.
 */
async function seedIndexedDB(page: Page, opts: { folders?: boolean } = {}) {
  const now = Date.now();
  const folders = opts.folders
    ? [
        {
          id: "fld-1",
          name: "User Endpoints",
          collectionId: "col-dnd",
          createdAt: now,
          updatedAt: now,
        },
      ]
    : [];

  const requests = opts.folders
    ? [
        {
          id: "req-a",
          name: "Get Users",
          method: "GET",
          url: "https://httpbin.org/get",
          endpoint: "/get",
          headers: {},
          body: "",
          bodyType: "json" as const,
          authType: "none" as const,
          authToken: "",
          queryParams: [],
          folderId: "fld-1",
          order: 1000,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "req-b",
          name: "Create Post",
          method: "POST",
          url: "https://httpbin.org/post",
          endpoint: "/post",
          headers: {},
          body: '{"title":"hello"}',
          bodyType: "json" as const,
          authType: "none" as const,
          authToken: "",
          queryParams: [],
          order: 2000,
          createdAt: now,
          updatedAt: now,
        },
      ]
    : [
        {
          id: "req-a",
          name: "Get Users",
          method: "GET",
          url: "https://httpbin.org/get",
          endpoint: "/get",
          headers: {},
          body: "",
          bodyType: "json" as const,
          authType: "none" as const,
          authToken: "",
          queryParams: [],
          order: 1000,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "req-b",
          name: "Create Post",
          method: "POST",
          url: "https://httpbin.org/post",
          endpoint: "/post",
          headers: {},
          body: '{"title":"hello"}',
          bodyType: "json" as const,
          authType: "none" as const,
          authToken: "",
          queryParams: [],
          order: 2000,
          createdAt: now,
          updatedAt: now,
        },
      ];

  await page.evaluate(
    ({ ts, reqs, flds }) => {
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
                  id: "col-dnd",
                  name: "DnD Collection",
                  description: "",
                  color: "emerald",
                  icon: "package",
                  workspaceId: "ws-personal",
                  folders: flds,
                  requests: reqs,
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
    },
    { ts: now, reqs: requests, flds: folders },
  );
}

/**
 * Helper: expand the DnD Collection by clicking its chevron button.
 */
async function expandCollection(page: Page) {
  // The chevron is a button with ChevronRight icon inside the collection row
  const chevron = page.getByTestId("collection-row").first().locator("button").nth(1);
  await chevron.click();
  await page.waitForTimeout(500);
}

/**
 * Helper: simulate a @dnd-kit compatible pointer drag from one element to another.
 * Uses page.keyboard for modifier keys so @dnd-kit's activatorEvent sees ctrlKey.
 */
async function simulateDrag(
  page: Page,
  dragHandleLocator: ReturnType<Page["locator"]>,
  targetLocator: ReturnType<Page["locator"]>,
  options?: { ctrlKey?: boolean },
) {
  // The drag handle needs group-hover to become visible
  // Force the element to be visible for Playwright
  await dragHandleLocator.evaluate((el) => {
    (el as HTMLElement).style.opacity = "1";
  });
  await page.waitForTimeout(100);

  const sourceBox = await dragHandleLocator.boundingBox();
  const targetBox = await targetLocator.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Could not find element bounds");

  const sx = sourceBox.x + sourceBox.width / 2;
  const sy = sourceBox.y + sourceBox.height / 2;
  const tx = targetBox.x + targetBox.width / 2;
  const ty = targetBox.y + targetBox.height / 2;

  // Hold Ctrl if needed (using keyboard.down so the actual pointer event has ctrlKey)
  if (options?.ctrlKey) {
    await page.keyboard.down("Control");
  }

  // Move to source and press
  await page.mouse.move(sx, sy);
  await page.mouse.down({ button: "left" });

  // Move in steps to activate @dnd-kit's distance sensor (needs >5px)
  await page.mouse.move(sx + 10, sy, { steps: 5 });
  await page.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 5 });
  await page.mouse.move(tx, ty, { steps: 5 });

  // Release
  await page.mouse.up({ button: "left" });

  // Release Ctrl if held
  if (options?.ctrlKey) {
    await page.keyboard.up("Control");
  }

  await page.waitForTimeout(500);
}

test.describe("Collections — Drag & Drop (Session 3)", () => {
  test("Ctrl+Drag duplicates a request within a collection", async ({ page }) => {
    await page.goto("/collections");
    await seedIndexedDB(page);
    await page.reload();

    // Expand the collection
    await expect(page.getByTestId("collection-row").first()).toBeVisible({ timeout: 20_000 });
    await expandCollection(page);

    // Both requests should be visible
    await expect(page.getByText("Get Users", { exact: false }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Create Post", { exact: false }).first()).toBeVisible();

    // Count drag handles before duplication
    const beforeCount = await page.locator('[data-testid^="drag-handle-"]').count();
    expect(beforeCount).toBe(2);

    // Ctrl+drag "Get Users" onto "Create Post"
    await simulateDrag(
      page,
      page.getByTestId("drag-handle-req-a"),
      page.getByText("Create Post", { exact: false }).first(),
      { ctrlKey: true },
    );

    // After Ctrl+drag, there should be 3 requests (the duplicate was created)
    const afterCount = await page.locator('[data-testid^="drag-handle-"]').count();
    expect(afterCount).toBe(3);
    // The duplicated request should be visible
    await expect(page.getByText("Get Users (copy)", { exact: false }).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("folder drop zone accepts dragged requests", async ({ page }) => {
    await page.goto("/collections");
    await seedIndexedDB(page, { folders: true });
    await page.reload();

    // Expand the collection
    await expect(page.getByTestId("collection-row").first()).toBeVisible({ timeout: 20_000 });
    await expandCollection(page);

    // The folder header should be visible with count (0)
    const folderHeader = page.getByText("User Endpoints", { exact: false }).first();
    await expect(folderHeader).toBeVisible({ timeout: 10_000 });

    // The folder drop zone should be visible
    const folderDrop = page.getByTestId("folder-drop-User Endpoints");
    await expect(folderDrop).toBeVisible();

    // "Create Post" should be root-level (not in folder)
    await expect(page.getByText("Create Post", { exact: false }).first()).toBeVisible();

    // Drag "Create Post" onto the folder drop zone
    await simulateDrag(page, page.getByTestId("drag-handle-req-b"), folderDrop);

    // The drag completed without error — both items still visible
    await expect(page.getByText("Get Users", { exact: false }).first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("Create Post", { exact: false }).first()).toBeVisible();
  });

  test("drag handle is present on each request row", async ({ page }) => {
    await page.goto("/collections");
    await seedIndexedDB(page);
    await page.reload();

    // Expand the collection
    await expect(page.getByTestId("collection-row").first()).toBeVisible({ timeout: 20_000 });
    await expandCollection(page);

    // Both drag handles should be present
    await expect(page.getByTestId("drag-handle-req-a")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("drag-handle-req-b")).toBeVisible();
  });

  test("folder with folder-flagged request displays correctly", async ({ page }) => {
    await page.goto("/collections");
    await seedIndexedDB(page, { folders: true });
    await page.reload();

    // Expand the collection
    await expect(page.getByTestId("collection-row").first()).toBeVisible({ timeout: 20_000 });
    await expandCollection(page);

    // The folder header should show with count (1) since "Get Users" is in the folder
    const folderLabel = page.getByText(/User Endpoints/).first();
    await expect(folderLabel).toBeVisible({ timeout: 10_000 });

    // "Get Users" should exist and be visible
    await expect(page.getByText("Get Users", { exact: false }).first()).toBeVisible();

    // "Create Post" should also be visible (root level)
    await expect(page.getByText("Create Post", { exact: false }).first()).toBeVisible();
  });
});
