// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-config-prettier";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-electron/**",
      "**/release/**",
      "**/node_modules/**",
      "**/*.config.js",
      "**/*.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { import: importPlugin },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          // The `@/` and `@shared/` path aliases (tsconfig + vite) are first-party code.
          pathGroups: [
            { pattern: "@/**", group: "internal" },
            { pattern: "@shared/**", group: "internal" },
          ],
          pathGroupsExcludedImportTypes: ["builtin", "external"],
          "newlines-between": "always",
        },
      ],
    },
  },
  {
    // Renderer architecture (see README "Renderer architecture"): the preload bridge is read in
    // exactly one place, and a feature is only reached through its public index.
    files: ["apps/pos-desktop/src/**/*.{ts,tsx}"],
    ignores: ["apps/pos-desktop/src/services/ipcClient.ts", "apps/pos-desktop/src/@types/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name=\"window\"][property.name=\"api\"]",
          message: "Call the preload bridge through a service (src/services or features/*/services), never window.api directly.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*/*", "!@/features/*/index.js", "**/features/*/components/*", "**/features/*/hooks/*", "**/features/*/services/*"],
              message: "Import a feature through its index (@/features/<name>/index.js), not its internals.",
            },
          ],
        },
      ],
    },
  },
  {
    // Inside a feature its own files import each other directly.
    files: ["apps/pos-desktop/src/features/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // A .tsx file exports components only; constants, types-with-values and helpers live in .ts files.
    files: ["apps/pos-desktop/src/**/*.tsx"],
    ignores: ["**/*.test.tsx"],
    plugins: { "react-refresh": reactRefresh },
    rules: { "react-refresh/only-export-components": ["error", { allowConstantExport: false }] },
  },
  {
    // Plain Node CLI script (run with `node`, not built) — outside the app's browser/Electron
    // type-checked sources, so it needs the two Node globals it uses declared explicitly.
    files: ["apps/pos-desktop/scripts/*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", Buffer: "readonly" },
    },
  },
  prettier,
);
