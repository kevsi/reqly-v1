import js from "@eslint/js";
import reqlyI18nPlugin from "./eslint-plugin-reqly-i18n.mjs";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "reqly-i18n": reqlyI18nPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_",
          "caughtErrorsIgnorePattern": "^_"
        }
      ],
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "no-useless-escape": "warn",
      "no-empty": "warn",
      // Dérive i18n (audit 2026-09-03): warn — bloque la nouvelle dérive sans
      // forcer la migration historique d'un coup.
      "reqly-i18n/no-hardcoded-jsx-text": "warn"
    },
  },
  {
    // Build output and vendored artifacts must never be linted. `out/` is the
    // static-export target of the desktop build (BUILD_TARGET=desktop).
    ignores: [
      ".next/",
      "out/",
      "dist/",
      "node_modules/",
      "build/",
      "playwright-report/",
      "test-results/",
      "coverage/",
    ],
  }
);
