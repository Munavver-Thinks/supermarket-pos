// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-config-prettier";
import reactRefresh from "eslint-plugin-react-refresh";

/** Node-only code (native SQLite, IPC input validation) that only the Electron main process may load. */
const MAIN_PROCESS_ONLY = [
  { name: "@pos/database", message: "The database runs in the Electron main process; reach it through IPC (src/services)." },
  { name: "@pos/validation", message: "IPC input validation runs in the Electron main process." },
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-electron/**",
      "**/release/**",
      "**/node_modules/**",
      "**/*.config.js",
      "**/*.config.ts",
      "**/*.config.mjs",
      "**/*.config.mts",
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
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/core/**", "src/services/ipcClient.ts", "src/@types/**"],
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
          paths: MAIN_PROCESS_ONLY,
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
    files: ["src/features/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { paths: MAIN_PROCESS_ONLY }] },
  },
  {
    // src/core is shared by the Electron main process and the renderer, so it stays framework-free.
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/**", "@shared/**", "react", "react-dom", "electron"],
              message: "src/core is shared by the main process and the renderer: no renderer, React or Electron imports.",
            },
          ],
        },
      ],
    },
  },
  {
    // The database layer may name business-logic types but never call it at runtime — the
    // formulas it needs are duplicated on purpose (see repositories/purchases.ts, sales.ts).
    files: ["src/core/database/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@pos/business-logic",
              allowTypeImports: true,
              message: "The database layer may import business-logic types only; duplicate the formula instead.",
            },
          ],
          patterns: [
            {
              group: ["@/**", "@shared/**", "react", "react-dom", "electron"],
              message: "src/core is shared by the main process and the renderer: no renderer, React or Electron imports.",
            },
          ],
        },
      ],
    },
  },
  {
    // A .tsx file exports components only; constants, types-with-values and helpers live in .ts files.
    files: ["src/**/*.tsx"],
    ignores: ["**/*.test.tsx"],
    plugins: { "react-refresh": reactRefresh },
    rules: { "react-refresh/only-export-components": ["error", { allowConstantExport: false }] },
  },
  {
    // Plain Node CLI script (run with `node`, not built) — outside the app's browser/Electron
    // type-checked sources, so it needs the two Node globals it uses declared explicitly.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", Buffer: "readonly" },
    },
  },
  prettier,
);
