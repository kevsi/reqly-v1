import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "lib/__tests__/**/*.test.{ts,tsx}",
      "lib/**/__tests__/**/*.test.{ts,tsx}",
      "src/ai/**/__tests__/**/*.test.{ts,tsx}",
      "src/ai/**/*.test.{ts,tsx}",
      "hooks/**/__tests__/**/*.test.{ts,tsx}",
      "components/**/__tests__/**/*.test.{ts,tsx}",
      "app/**/__tests__/**/*.test.{ts,tsx}",
      "app/api/**/__tests__/**/*.test.ts",
      "modules/**/*.test.{ts,tsx}",
    ],
    exclude: ["node_modules", ".next"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      // Only gate the unit-testable logic. UI (components/app), build scripts,
      // type shims and the test files themselves are out of unit scope.
      exclude: [
        "node_modules",
        ".next",
        "coverage",
        "**/*.d.ts",
        "scripts/**",
        "types/**",
        "components/**",
        "app/**",
        "src/ai/components/**",
        "tests/**",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/__tests__/**",
        // Root-level config files are not unit-testable logic; including them
        // as 0%-covered files drags the baseline down without signal.
        "**/*.config.{js,mjs,ts}",
        "vitest.setup.ts",
        "proxy.ts",
        // Module UI pages (equivalent to app/**) — unit-testable logic lives
        // in the sibling codec.ts/manifest.ts files, which stay covered.
        "modules/**/page.{ts,tsx}",
      ],
      // Floors locked to the baseline measured 2026-08-06 after the
      // detect-shared test suite landed (scoped to unit-testable logic):
      // statements 45.6%, lines 45.6%, functions 65.1%, branches 69.3%.
      // CI fails only on a significant drop, not on the absolute level.
      // Sprint target: keep raising toward 60% global for statements/lines
      // (functions already above) as coverage grows (docs/BUNDLE_OPTIMIZATION.md).
      thresholds: {
        global: {
          statements: 42,
          lines: 42,
          functions: 60,
          branches: 65,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `java-parser` is optional (regex fallback when absent); the tests must
      // still transform, so resolve it to a stub.
      "java-parser": path.resolve(__dirname, "test/java-parser-stub.ts"),
    },
  },
});
