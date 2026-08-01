import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
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
      ],
      // Floor locked to the measured baseline (scoped to unit-testable logic).
      // CI fails only on a significant drop, not on the absolute level.
      thresholds: {
        global: {
          statements: 30,
          branches: 70,
          functions: 55,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
