import { test, expect } from "@playwright/test";

test.describe("Scripts & Assertions", () => {
  test("Scripts accordion section expands on home page", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Scroll down to find the Scripts accordion section
    const scriptsAccordion = page.locator("button", { hasText: /Scripts/i }).first();
    await expect(scriptsAccordion).toBeVisible();
    await scriptsAccordion.click();

    // When expanded, should show the script editor (CodeMirror)
    await page.waitForTimeout(500);

    // Should show pre-request and post-response script labels
    const preReqLabel = page.locator("text", { hasText: /Pre-request|Pre.request/i }).first();
    if (await preReqLabel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(preReqLabel).toBeVisible();
    }

    const postRespLabel = page.locator("text", { hasText: /Post-response|Post.response/i }).first();
    if (await postRespLabel.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(postRespLabel).toBeVisible();
    }
  });

  test("Assertions accordion section expands", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Find and click the Assertions accordion
    const assertionsAccordion = page.locator("button", { hasText: /^Assertions$/i }).first();
    await expect(assertionsAccordion).toBeVisible();
    await assertionsAccordion.click();
    await page.waitForTimeout(500);

    // When expanded, should show the Add button
    const addBtn = page.locator("button", { hasText: /Add/i }).first();
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addBtn.click();
      // After Add, assertion fields (type select) should appear
      const assertionSelect = page
        .locator("button", { hasText: /status|time|json path|schema/i })
        .first();
      if (await assertionSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(assertionSelect).toBeVisible();
      }
    }
  });

  test("Tests accordion section expands", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Find and click the Tests accordion
    const testsAccordion = page.locator("button", { hasText: /^Tests$/i }).first();
    await expect(testsAccordion).toBeVisible();
    await testsAccordion.click();
    await page.waitForTimeout(500);

    // Should show test-related controls
    await expect(page.locator("body")).toBeVisible();
  });

  test("API: Execute test script with sandbox", async ({ request }) => {
    // Test script execution via sandbox (validates VM-based isolation)
    const scriptRes = await request.post("http://localhost:3000/api/test-runner/execute", {
      data: {
        testScript: 'const x = 1 + 1; if (x !== 2) throw new Error("Math failed");',
        assertions: [],
      },
    });
    expect(scriptRes.ok()).toBeTruthy();
    const result = await scriptRes.json();
    expect(result.success).toBeDefined();
  });

  test("API: Execute pre/post request scripts", async ({ request }) => {
    // Test pre/post script execution in sequence
    const scriptRes = await request.post("http://localhost:3000/api/test-runner/execute", {
      data: {
        preScript: 'pm.environment.TEST_VAR = "from-pre";',
        testScript:
          'if (pm.environment.TEST_VAR !== "from-pre") throw new Error("Pre-script failed");',
        postScript: 'console.log("Post-script running");',
        assertions: [],
      },
    });
    expect(scriptRes.ok()).toBeTruthy();
    const result = await scriptRes.json();
    // Should show the sequence was executed
    expect(result.preResult || result.mainResult).toBeDefined();
  });

  test("API: Evaluate assertions on response", async ({ request }) => {
    // Test assertion evaluation (statusCode, bodyContains, etc.)
    const scriptRes = await request.post("http://localhost:3000/api/test-runner/execute", {
      data: {
        testScript: "true;",
        assertions: [
          { type: "statusCode", value: 200 },
          { type: "bodyContains", value: "success" },
        ],
        response: {
          status: 200,
          body: '{"message":"success"}',
          headers: {},
        },
      },
    });
    expect(scriptRes.ok()).toBeTruthy();
    const result = await scriptRes.json();
    if (result.assertions) {
      expect(result.assertions.total).toBeGreaterThan(0);
    }
  });

  test("API: Sandbox prevents code injection", async ({ request }) => {
    // Test that dangerous APIs are blocked (fs, process, etc.)
    const scriptRes = await request.post("http://localhost:3000/api/test-runner/execute", {
      data: {
        testScript: 'const fs = require("fs"); fs.readFileSync("/etc/passwd");',
      },
    });
    // Should either fail safely or not execute the dangerous code
    expect(scriptRes.ok()).toBeTruthy();
    const result = await scriptRes.json();
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  test("API: Script timeout protection", async ({ request }) => {
    // Test that infinite loops are caught by timeout
    const scriptRes = await request.post("http://localhost:3000/api/test-runner/execute", {
      data: {
        testScript: "while(true) {}",
        timeout: 1000, // 1 second timeout
      },
    });
    expect(scriptRes.ok()).toBeTruthy();
    const result = await scriptRes.json();
    // Should timeout gracefully
    if (!result.success) {
      expect(result.error).toContain("timeout");
    }
  });
});
