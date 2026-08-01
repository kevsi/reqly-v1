import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Force production auth behaviour so the `requireAuth` 401 paths are exercised
    // (dev mode mocks a session and would mask auth failures). A unique on-disk DB
    // per test file is assigned in ./src/__tests__/setup.ts so tests stay isolated
    // and the WAL/foreign-key pragmas match production.
    setupFiles: ["./src/__tests__/setup.ts"],
    env: {
      NODE_ENV: "production",
      AUTH_SIGNING_SECRET: "test-secret-do-not-use-in-prod",
    },
  },
});
