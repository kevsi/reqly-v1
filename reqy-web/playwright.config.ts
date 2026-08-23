import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : "list",
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10000,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: "pnpm build && pnpm start -p 3000",
    port: 3000,
    reuseExistingServer: process.env.CI !== "true",
    cwd: __dirname,
    // The webServer command performs a full production build before starting Next.
    // Keep the gate above the observed build time on CI and developer machines.
    timeout: 360000,
  },
});
