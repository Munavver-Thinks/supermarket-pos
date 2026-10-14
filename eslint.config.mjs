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

/** Every src/core module stays framework-free; each also gets its own import limits. */
const CORE_FRAMEWORK_FREE = {
  group: ["@/**", "@shared/**", "react", "react-dom", "electron"],
  message: "src/core is shared by the main process and the renderer: no renderer, React or Electron imports.",
};

function coreModule(files, { paths = [], patterns = [] }, ignores = []) {
  return {
    files: [files],
    ignores,
    rules: {
      "no-restricted-imports": ["error", { paths, patterns: [CORE_FRAMEWORK_FREE, ...patterns] }],
    },
  };
}

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
    // exactly one place, and a main module folder is only reached through its public index.
    files: ["src/**/*.{ts,tsx}"],
    // Tests (src/tests) exercise internals and the main process directly, so they are exempt.
    ignores: ["src/core/**", "src/tests/**", "src/services/ipcClient.ts", "src/@types/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name=\"window\"][property.name=\"api\"]",
          message: "Call the preload bridge through a service (src/services or main-modules/*/services), never window.api directly.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: MAIN_PROCESS_ONLY,
          patterns: [
            {
              group: ["@/main-modules/*/*", "!@/main-modules/*/index.js", "**/main-modules/*/components/*", "**/main-modules/*/hooks/*", "**/main-modules/*/services/*"],
              message: "Import a main module through its index (@/main-modules/<name>/index.js), not its internals.",
            },
          ],
        },
      ],
    },
  },
  {
    // Inside a main module folder its own files import each other directly.
    files: ["src/main-modules/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { paths: MAIN_PROCESS_ONLY }] },
  },
  // src/core/* were separate packages; these rules keep the import graph their package.json
  // files used to enforce: types and validation import nothing else from core, business-logic
  // may use types, and the database may use types plus business-logic *types* only.
  coreModule("src/core/types/**/*.ts", {
    patterns: [{ group: ["@pos/*"], message: "types depends on nothing else in src/core." }],
  }),
  coreModule("src/core/validation/**/*.ts", {
    patterns: [{ group: ["@pos/*"], message: "validation depends on nothing else in src/core." }],
  }),
  coreModule("src/core/business-logic/**/*.ts", { paths: MAIN_PROCESS_ONLY }),
  coreModule(
    "src/core/database/**/*.ts",
    {
      paths: [
        {
          name: "@pos/business-logic",
          allowTypeImports: true,
          // The formulas it needs are duplicated on purpose (see repositories/purchases.ts, sales.ts).
          message: "The database layer may import business-logic types only; duplicate the formula instead.",
        },
        { name: "@pos/validation", message: "IPC input validation belongs to the main-process handlers, not the database." },
      ],
    },
    // Database tests may call business-logic to cross-check the duplicated formulas.
    ["**/*.test.ts"],
  ),
  {
    // Core code also runs in the Electron main process, where these browser globals do not exist.
    files: ["src/core/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...["window", "document", "navigator", "localStorage", "sessionStorage"].map((name) => ({
          name,
          message: "src/core runs in the Electron main process too — no browser globals.",
        })),
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
